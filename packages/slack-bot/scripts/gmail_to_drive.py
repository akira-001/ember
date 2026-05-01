#!/usr/bin/env python3
"""
Gmail → Google Drive 自動保存スクリプト
領収書・請求書を Gmail から検索して Drive に保存し、アーカイブする

mcporter/OpenClaw 依存なし。Gmail API / Drive API を直接呼び出す。
"""

import base64
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime


# === 認証情報 ===

def _load_secrets():
    secrets_file = os.path.expanduser("~/.openclaw/credentials/secrets.env")
    if os.path.exists(secrets_file):
        with open(secrets_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"'))

_load_secrets()

# Drive API 用
DRIVE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
DRIVE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
DRIVE_TOKEN_FILE = os.path.expanduser("~/.openclaw/credentials/google_drive_token.json")

# Gmail API 用（gmail-mcp の OAuth クライアント）
GMAIL_KEYS_FILE = os.path.expanduser("~/.gmail-mcp/gcp-oauth.keys.json")
GMAIL_CREDS_FILE = os.path.expanduser("~/.gmail-mcp/credentials.json")


def _get_gmail_oauth():
    """Gmail API 用の client_id, client_secret, refresh_token を返す"""
    with open(GMAIL_KEYS_FILE) as f:
        keys = json.load(f).get("installed", {})
    with open(GMAIL_CREDS_FILE) as f:
        creds = json.load(f)
    return keys["client_id"], keys["client_secret"], creds["refresh_token"]


def _refresh_access_token(client_id, client_secret, refresh_token):
    """OAuth2 リフレッシュトークンからアクセストークンを取得"""
    data = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=data)
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())["access_token"]


def get_gmail_token():
    cid, csec, rt = _get_gmail_oauth()
    return _refresh_access_token(cid, csec, rt)


def get_drive_token():
    with open(DRIVE_TOKEN_FILE) as f:
        rt = json.load(f)["refresh_token"]
    return _refresh_access_token(DRIVE_CLIENT_ID, DRIVE_CLIENT_SECRET, rt)


# === Gmail API ===

def gmail_api(token, path, method="GET", body=None):
    """Gmail REST API を呼ぶ汎用関数"""
    url = f"https://gmail.googleapis.com/gmail/v1/users/me/{path}"
    headers = {"Authorization": f"Bearer {token}"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def search_emails(token, query, max_results=20):
    """メッセージIDのリストを返す"""
    q = urllib.parse.urlencode({"q": query, "maxResults": max_results})
    result = gmail_api(token, f"messages?{q}")
    return [m["id"] for m in result.get("messages", [])]


def read_email(token, msg_id):
    """メッセージの詳細を返す（headers + body）"""
    return gmail_api(token, f"messages/{msg_id}?format=full")


def download_attachment(token, msg_id, att_id):
    """添付ファイルのバイナリデータを返す"""
    result = gmail_api(token, f"messages/{msg_id}/attachments/{att_id}")
    # Gmail API は base64url エンコードで返す
    return base64.urlsafe_b64decode(result["data"])


def get_or_create_label(token, label_name):
    """ラベルIDを取得（なければ作成）"""
    labels = gmail_api(token, "labels")
    for lbl in labels.get("labels", []):
        if lbl["name"] == label_name:
            return lbl["id"]
    # 作成
    result = gmail_api(token, "labels", method="POST", body={
        "name": label_name,
        "labelListVisibility": "labelShow",
        "messageListVisibility": "show",
    })
    return result["id"]


def modify_email(token, msg_id, add_labels=None, remove_labels=None):
    """ラベルの追加・削除"""
    body = {}
    if add_labels:
        body["addLabelIds"] = add_labels
    if remove_labels:
        body["removeLabelIds"] = remove_labels
    gmail_api(token, f"messages/{msg_id}/modify", method="POST", body=body)


# === ヘルパー ===

def get_header(msg, name):
    """メッセージヘッダから値を取得"""
    for h in msg.get("payload", {}).get("headers", []):
        if h["name"].lower() == name.lower():
            return h["value"]
    return ""


def find_pdf_attachments(payload):
    """payload ツリーを再帰的に走査して PDF 添付を返す [(filename, attachmentId)]"""
    results = []
    if payload.get("mimeType") == "application/pdf" and payload.get("body", {}).get("attachmentId"):
        fname = payload.get("filename", "attachment.pdf")
        results.append((fname, payload["body"]["attachmentId"]))
    for part in payload.get("parts", []):
        results.extend(find_pdf_attachments(part))
    return results


def get_body_text(payload):
    """本文テキストを取得（添付のStripe URLチェック用）"""
    if payload.get("mimeType", "").startswith("text/") and payload.get("body", {}).get("data"):
        return base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="replace")
    text = ""
    for part in payload.get("parts", []):
        text += get_body_text(part)
    return text


def parse_email_date(msg):
    """Date ヘッダから (YYYYMMDD, year) を返す"""
    date_raw = get_header(msg, "Date")
    if date_raw:
        for fmt in ("%a, %d %b %Y %H:%M:%S %z", "%a, %d %b %Y %H:%M:%S %Z",
                     "%d %b %Y %H:%M:%S %z"):
            try:
                dt = datetime.strptime(date_raw.split(" (")[0].strip(), fmt)
                return dt.strftime("%Y%m%d"), str(dt.year)
            except ValueError:
                continue
        year_match = re.search(r"(\d{4})", date_raw)
        if year_match:
            return datetime.now().strftime("%Y%m%d"), year_match.group(1)
    return datetime.now().strftime("%Y%m%d"), str(datetime.now().year)


# === Drive API ===

# 年度フォルダID（redperth@gmail.com の Drive）
FOLDER_IDS = {
    "receipt": {"parent": "19w5drjOukTUx56qCHkmoRktDaSwaNw8T"},
    "invoice": {"parent": "1fVkpSTcehrYmPL7iYd5dn8sqskukSDVd"},
}

_year_folder_cache = {}


def get_year_folder_id(kind, year=None, access_token=None):
    """親フォルダ内の年サブフォルダを検索し、なければ作成して返す"""
    year = year or str(datetime.now().year)
    cache_key = f"{kind}/{year}"
    if cache_key in _year_folder_cache:
        return _year_folder_cache[cache_key]

    parent_id = FOLDER_IDS.get(kind, {}).get("parent")
    if not parent_id:
        return None

    if not access_token:
        access_token = get_drive_token()

    q = urllib.parse.quote(
        f"'{parent_id}' in parents and name = '{year}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    )
    url = f"https://www.googleapis.com/drive/v3/files?q={q}&fields=files(id,name)"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {access_token}"})
    with urllib.request.urlopen(req) as r:
        files = json.loads(r.read()).get("files", [])

    if files:
        folder_id = files[0]["id"]
    else:
        metadata = json.dumps({
            "name": year,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        })
        req = urllib.request.Request(
            "https://www.googleapis.com/drive/v3/files",
            data=metadata.encode(),
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(req) as r:
            folder_id = json.loads(r.read())["id"]
        print(f"年フォルダ作成: {kind}/{year} ({folder_id})")

    _year_folder_cache[cache_key] = folder_id
    return folder_id


def upload_to_drive(access_token, file_path, file_name, folder_id):
    boundary = "boundary_gmail_drive"
    metadata = json.dumps({"name": file_name, "parents": [folder_id]})

    with open(file_path, "rb") as f:
        file_data = f.read()

    body = (
        f"--{boundary}\r\n"
        f"Content-Type: application/json; charset=UTF-8\r\n\r\n"
        f"{metadata}\r\n"
        f"--{boundary}\r\n"
        f"Content-Type: application/pdf\r\n\r\n"
    ).encode() + file_data + f"\r\n--{boundary}--".encode()

    req = urllib.request.Request(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
        data=body,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": f"multipart/related; boundary={boundary}",
        }
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


# === 設定 ===

PROCESSED_LABEL_NAME = "drive-saved"

RECEIPT_QUERY = 'in:anywhere newer_than:3d -label:drive-saved (subject:(領収書 OR receipt OR "your receipt") OR from:(stripe.com OR invoice))'
INVOICE_QUERY = "in:anywhere newer_than:3d -label:drive-saved subject:(請求書 OR invoice OR INV)"

EXCLUDE_PATTERNS = [
    r"datumix",
]

# 手動保存通知から除外するパターン（マーケティング/通知メール）
MANUAL_EXCLUDE_PATTERNS = [
    r"updates@e\.stripe\.com",       # Stripe マーケティング
    r"founders@e\.stripe\.com",      # Stripe 年次報告
    r"no-reply@amazonaws\.com",      # AWS 通知
    r"Payments Summit",              # イベント案内
    r"年次報告書",
    r"Annual Letter",
]

# Slack 通知先（トークン失効時）
SLACK_ALERT_CHANNEL = "C0AHQV1ME4S"
SLACK_MENTION = "<@U3SFGQXNH>"


# === メイン処理 ===

def check_gmail_token():
    """Gmail トークンが有効か確認"""
    try:
        get_gmail_token()
        return True
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        if "invalid_grant" in body:
            reason = "リフレッシュトークンが失効しています (invalid_grant)"
            print(f"ERROR: {reason}", file=sys.stderr)
            # Slack 通知はスクリプト出力を scheduler が送信するので stderr + exit で十分
            return False
        raise
    except FileNotFoundError:
        print("ERROR: Gmail 認証ファイルが見つかりません", file=sys.stderr)
        return False


def process_emails(query, kind, gmail_token, drive_token, label_id=None, manual_list=None):
    saved = []

    msg_ids = search_emails(gmail_token, query)

    for msg_id in msg_ids:
        msg = read_email(gmail_token, msg_id)
        subject = get_header(msg, "Subject") or "unknown"
        sender = get_header(msg, "From") or "unknown"
        body_text = get_body_text(msg.get("payload", {}))
        full_text = subject + " " + body_text

        # 除外パターンチェック
        if any(re.search(pat, full_text, re.IGNORECASE) for pat in EXCLUDE_PATTERNS):
            print(f"スキップ(除外): {subject[:80]}")
            continue

        date_str, year = parse_email_date(msg)

        # PDF 添付を探す
        attachments = find_pdf_attachments(msg.get("payload", {}))

        if attachments:
            all_uploaded = True
            for filename, att_id in attachments:
                fname_lower = filename.lower()
                if fname_lower.startswith("invoice"):
                    att_kind = "invoice"
                elif fname_lower.startswith("receipt"):
                    att_kind = "receipt"
                else:
                    att_kind = kind
                att_folder_id = get_year_folder_id(att_kind, year, drive_token)
                save_name = f"{date_str}_{filename}"

                try:
                    pdf_data = download_attachment(gmail_token, msg_id, att_id)
                    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                        tmp.write(pdf_data)
                        tmp_path = tmp.name
                    result = upload_to_drive(drive_token, tmp_path, save_name, att_folder_id)
                    os.unlink(tmp_path)
                    if "id" in result:
                        saved.append(f"{att_kind}/{year}: {save_name} (From: {sender}, Subject: {subject})")
                        print(f"保存: {save_name} -> {att_kind}/{year}/")
                    else:
                        all_uploaded = False
                except Exception as e:
                    print(f"ERROR: 添付DL/アップロード失敗 {filename}: {e}", file=sys.stderr)
                    all_uploaded = False

            if all_uploaded:
                modify_email(gmail_token, msg_id,
                             add_labels=[label_id] if label_id else None,
                             remove_labels=["INBOX"])
        else:
            # Stripe 等のリンク形式 PDF
            pdf_urls = re.findall(r"(https://pay\.stripe\.com/invoice/[^\s]+pdf[^\s]*)", body_text)
            if pdf_urls:
                safe_subject = re.sub(r'[^\w\s-]', '', subject)[:80].strip()
                save_name = f"{date_str}_{safe_subject}.pdf"
                folder_id = get_year_folder_id(kind, year, drive_token)
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                    tmp_path = tmp.name
                try:
                    urllib.request.urlretrieve(pdf_urls[0], tmp_path)
                    result = upload_to_drive(drive_token, tmp_path, save_name, folder_id)
                    if "id" in result:
                        modify_email(gmail_token, msg_id,
                                     add_labels=[label_id] if label_id else None,
                                     remove_labels=["INBOX"])
                        saved.append(f"{kind}/{year}: {save_name} (From: {sender}, Subject: {subject})")
                        print(f"保存: {save_name} -> {kind}/{year}/")
                finally:
                    os.unlink(tmp_path)
            else:
                # PDF添付もStripeリンクもない → 手動保存が必要
                sender = get_header(msg, "From") or "unknown"
                check_text = sender + " " + subject
                if manual_list is not None and not any(
                    re.search(pat, check_text, re.IGNORECASE) for pat in MANUAL_EXCLUDE_PATTERNS
                ):
                    manual_list.append(f"[{date_str}] {sender[:40]} | {subject[:60]}")

    return saved


if __name__ == "__main__":
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M')}] Gmail -> Drive 同期開始")

    if not DRIVE_CLIENT_ID or not DRIVE_CLIENT_SECRET:
        print("ERROR: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が設定されていません", file=sys.stderr)
        sys.exit(1)

    if not check_gmail_token():
        print("Gmail トークンが無効です。処理を中断します。")
        sys.exit(1)

    gmail_token = get_gmail_token()
    drive_token = get_drive_token()

    label_id = get_or_create_label(gmail_token, PROCESSED_LABEL_NAME)
    print(f"処理済みラベル: {PROCESSED_LABEL_NAME} (ID: {label_id})")

    results = []
    manual = []
    results += process_emails(RECEIPT_QUERY, "receipt", gmail_token, drive_token, label_id, manual)
    results += process_emails(INVOICE_QUERY, "invoice", gmail_token, drive_token, label_id, manual)

    if results:
        print(f"\n完了: {len(results)}件保存")
        for r in results:
            print(f"  {r}")

    if manual:
        # 重複除去
        manual = list(dict.fromkeys(manual))
        print(f"\n[要手動保存] PDF添付なしの請求・領収メール {len(manual)}件:")
        for m in manual:
            print(f"  {m}")
        print("請求書・領収書のダウンロードと Drive への手動保存をお願いします。")

    if not results and not manual:
        print("新しい領収書・請求書なし")
