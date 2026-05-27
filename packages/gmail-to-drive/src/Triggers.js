function installTriggers() {
  const existing = ScriptApp.getProjectTriggers();
  for (const t of existing) {
    if (t.getHandlerFunction() === 'main') ScriptApp.deleteTrigger(t);
  }
  ScriptApp.newTrigger('main')
    .timeBased()
    .everyWeeks(1)
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .create();
  Logger.log('Installed weekly Monday 9:00 JST trigger for main()');
}

function listTriggers() {
  for (const t of ScriptApp.getProjectTriggers()) {
    Logger.log(`${t.getHandlerFunction()} eventType=${t.getEventType()} sourceId=${t.getTriggerSourceId() || ''}`);
  }
}

function uninstallTriggers() {
  const existing = ScriptApp.getProjectTriggers();
  for (const t of existing) ScriptApp.deleteTrigger(t);
  Logger.log(`Removed ${existing.length} triggers`);
}
