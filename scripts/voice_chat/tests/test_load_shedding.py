import app


def test_normalize_text_signature_collapses_spacing_and_punctuation():
    assert app._normalize_text_signature("  進捗、確認！  ") == "進捗確認"


def test_dedupe_texts_for_batch_removes_duplicate_snippets():
    assert app._dedupe_texts_for_batch(["進捗確認", "進捗確認", "TODO確認"]) == ["進捗確認", "TODO確認"]


def test_low_value_backchannel_detection_distinguishes_short_acknowledgements():
    assert app._is_low_value_backchannel_text("うんうん") is True
    assert app._is_low_value_backchannel_text("次回までに資料を整理して共有するね") is False
