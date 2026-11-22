// Each dated task becomes an all-day event. No account or network access.
function icalText(value) {
  return String(value).replaceAll('\\','\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/[,;]/g,c => '\\' + c);
}

function foldLine(line) {
  let bytes = 0, output = '';
  const encoder = new TextEncoder();
  for (const c of line) {
    const width = encoder.encode(c).length;
    if (bytes + width > 75) { output += '\r\n '; bytes = 1; }
    output += c; bytes += width;
  }
  return output;
}

export function taskCalendar(meeting, tasks, date = new Date()) {
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//ECHO-404//Agenda//ES','CALSCALE:GREGORIAN'];
  for (const task of tasks.filter(t => t.meetingId === meeting.id && t.due)) {
    const day = new Date(task.due + 'T00:00:00Z');
    if (!Number.isFinite(+day) || day.toISOString().slice(0,10) !== task.due) continue;
    lines.push('BEGIN:VEVENT','UID:' + icalText(task.id) + '@echo404.local',
      'DTSTAMP:' + date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''), 'DTSTART;VALUE=DATE:' + task.due.replaceAll('-',''),
      'SUMMARY:' + icalText(task.text),'DESCRIPTION:' + icalText([meeting.title,task.owner].filter(Boolean).join(' · ')),'END:VEVENT');
  }
  if (!lines.includes('BEGIN:VEVENT')) throw Error('Añade una tarea con fecha antes de exportar al calendario.');
  return lines.concat('END:VCALENDAR').map(foldLine).join('\r\n') + '\r\n';
}
