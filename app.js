/* ── todo.sh — app logic ─────────────────────────────────────── */
'use strict';

const LS_TASKS = 'todos.v1';
const LS_KEY = 'anthropic_key';
const LS_MODEL = 'anthropic_model';
const DEFAULT_MODEL = 'claude-opus-4-8';
const DAY = 24 * 60 * 60 * 1000;

let tasks = load();
let filter = 'all';

/* ── storage ── */
function load() {
  try { return JSON.parse(localStorage.getItem(LS_TASKS)) || []; }
  catch { return []; }
}
function save() {
  localStorage.setItem(LS_TASKS, JSON.stringify(tasks));
}
function uid() {
  return (crypto.randomUUID) ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function startOfDay(ts) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0); return +d;
}

/* ── natural-language parsing (es + en, offline) ─────────────── */
const WEEKDAYS = {
  domingo: 0, sunday: 0,
  lunes: 1, monday: 1,
  martes: 2, tuesday: 2,
  miercoles: 3, 'miércoles': 3, wednesday: 3,
  jueves: 4, thursday: 4,
  viernes: 5, friday: 5,
  sabado: 6, 'sábado': 6, saturday: 6,
};
const WEEKDAY_RE = Object.keys(WEEKDAYS).join('|');

function parseInput(raw) {
  let text = ' ' + raw.trim() + ' ';
  let priority = 0;
  let date = null;        // Date at local midnight
  let hour = null, minute = 0;
  let repeat = null;      // 'daily' | 'weekly'

  // priority: trailing bangs
  const bang = text.match(/(!{1,3})\s*$/);
  if (bang) {
    priority = Math.min(bang[1].length, 3);
    text = text.slice(0, bang.index) + ' ';
  }
  // priority: urgent word
  if (/(^|\s)(urgente?|urgent)(\s|$)/i.test(text)) {
    priority = 3;
    text = text.replace(/(^|\s)(urgente?|urgent)(?=\s|$)/i, '$1');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // recurrence: daily
  const dailyRe = /(^|\s)(todos\s+los\s+d[ií]as|cada\s+d[ií]a|diario|diaria|every\s+day|daily)(?=\s|$)/i;
  if (dailyRe.test(text)) {
    repeat = 'daily';
    date = new Date(+today);
    text = text.replace(dailyRe, ' ');
  }
  // recurrence: weekly ("cada martes", "todos los lunes", "every monday")
  const weeklyRe = new RegExp('(^|\\s)(?:cada|todos\\s+los|every)\\s+(' + WEEKDAY_RE + ')s?(?=\\s|$)', 'i');
  const wk = text.match(weeklyRe);
  if (!repeat && wk) {
    repeat = 'weekly';
    const target = WEEKDAYS[wk[2].toLowerCase().replace(/s$/, '')] ?? WEEKDAYS[wk[2].toLowerCase()];
    const diff = (target - today.getDay() + 7) % 7;
    date = new Date(+today + diff * DAY);
    text = text.replace(weeklyRe, ' ');
  }

  function take(re, fn) {
    if (date) return;
    const m = text.match(re);
    if (m) {
      date = fn(m);
      text = text.replace(re, ' ');
    }
  }

  // ISO date: 2026-07-20
  take(/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) =>
    new Date(+m[1], +m[2] - 1, +m[3]));
  // M/D or M/D/Y (US style)
  take(/(^|\s)(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s|$)/, (m) => {
    const mo = +m[2] - 1, d = +m[3];
    let y = m[4] ? (+m[4] < 100 ? 2000 + +m[4] : +m[4]) : today.getFullYear();
    let dt = new Date(y, mo, d);
    if (!m[4] && dt < today) dt = new Date(y + 1, mo, d);
    return dt;
  });
  // relative phrases (longest first)
  take(/(^|\s)pasado\s+ma[ñn]ana(?=\s|$)/i, () => new Date(+today + 2 * DAY));
  take(/(^|\s)day\s+after\s+tomorrow(?=\s|$)/i, () => new Date(+today + 2 * DAY));
  take(/(^|\s)(la\s+)?pr[óo]xima\s+semana(?=\s|$)/i, () => new Date(+today + 7 * DAY));
  take(/(^|\s)next\s+week(?=\s|$)/i, () => new Date(+today + 7 * DAY));
  take(/(^|\s)en\s+(\d+)\s+d[ií]as?(?=\s|$)/i, (m) => new Date(+today + (+m[2]) * DAY));
  take(/(^|\s)in\s+(\d+)\s+days?(?=\s|$)/i, (m) => new Date(+today + (+m[2]) * DAY));
  take(/(^|\s)(hoy|today)(?=\s|$)/i, () => new Date(+today));
  take(/(^|\s)(ma[ñn]ana|tomorrow)(?=\s|$)/i, () => new Date(+today + DAY));
  // weekday name (next occurrence)
  take(new RegExp('(^|\\s)(?:el\\s+|on\\s+)?(' + WEEKDAY_RE + ')(?=\\s|$)', 'i'), (m) => {
    const target = WEEKDAYS[m[2].toLowerCase()];
    let diff = (target - today.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    return new Date(+today + diff * DAY);
  });

  // time: "5:30pm" / "17:00" / "5pm" / "a las 5pm"
  let tm = text.match(/(^|\s)(?:a\s+las?\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?(?=\s|$)/i);
  if (tm) {
    hour = +tm[2]; minute = +tm[3];
    if (tm[4]) hour = to24(hour, tm[4]);
    text = text.replace(tm[0], ' ');
  } else {
    tm = text.match(/(^|\s)(?:a\s+las?\s+)?(\d{1,2})\s*(am|pm)(?=\s|$)/i);
    if (tm) {
      hour = to24(+tm[2], tm[3]);
      text = text.replace(tm[0], ' ');
    }
  }

  // time without a date → today (or tomorrow if already past, unless recurring)
  if (hour !== null && !date) {
    date = new Date(+today);
    const candidate = new Date(+date); candidate.setHours(hour, minute);
    if (candidate < new Date() && !repeat) date = new Date(+today + DAY);
  }

  let due = null, dueHasTime = false;
  if (date) {
    if (hour !== null) { date.setHours(hour, minute, 0, 0); dueHasTime = true; }
    else { date.setHours(23, 59, 0, 0); }
    due = +date;
  }

  return { text: text.replace(/\s+/g, ' ').trim(), priority, due, dueHasTime, repeat };
}

function to24(h, ampm) {
  ampm = ampm.toLowerCase();
  if (ampm === 'pm' && h < 12) return h + 12;
  if (ampm === 'am' && h === 12) return 0;
  return h;
}

function formatDue(due, hasTime) {
  const d = new Date(due);
  const diff = Math.round((startOfDay(due) - startOfDay(Date.now())) / DAY);
  let label;
  if (diff === 0) label = 'hoy';
  else if (diff === 1) label = 'mañana';
  else if (diff > 1 && diff < 7) label = d.toLocaleDateString('es', { weekday: 'short' });
  else label = d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
  if (hasTime) label += ' ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false });
  return label;
}

/* recurring: next occurrence after completing */
function advanceRepeat(t) {
  const step = t.repeat === 'daily' ? 1 : 7;
  const d = new Date(t.due);
  const now = new Date();
  do { d.setDate(d.getDate() + step); } while (d <= now);
  t.due = +d;
}

/* ── bulk import (from Claude or any pasted list) ────────────── */
function cleanLine(s) {
  return s.replace(/^\s*(?:[-*•·#>]+|\d+[.)])\s*/, '').trim();
}
function importTasks(items) {
  let added = 0;
  for (const item of items) {
    const line = cleanLine(String(item));
    if (!line) continue;
    const parsed = parseInput(line);
    if (!parsed.text) continue;
    const dup = tasks.some(t => !t.done && t.text.toLowerCase() === parsed.text.toLowerCase());
    if (dup) continue;
    tasks.push({
      id: uid(), text: parsed.text, done: false,
      priority: parsed.priority, due: parsed.due,
      dueHasTime: parsed.dueHasTime, repeat: parsed.repeat,
      subtasks: [], createdAt: Date.now(),
    });
    added++;
  }
  if (added) { save(); render(); }
  return added;
}
function importFromHash() {
  const m = location.hash.match(/^#add=(.+)/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  let items = null;
  try { items = JSON.parse(decodeURIComponent(m[1])); } catch { }
  if (Array.isArray(items)) {
    const n = importTasks(items);
    toast(n ? `✦ ${n} tarea${n === 1 ? '' : 's'} agregada${n === 1 ? '' : 's'} desde Claude` : 'Nada nuevo que importar', n > 0);
  }
}

/* ── calendar export (.ics → native iPhone alerts) ───────────── */
function downloadIcs(t) {
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date(t.due);
  const stamp = new Date();
  const fmtLocal = (x) => `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}T${pad(x.getHours())}${pad(x.getMinutes())}00`;
  const fmtDate = (x) => `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}`;
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//todo.sh//ES', 'BEGIN:VEVENT',
    `UID:${t.id}@todo.sh`,
    `DTSTAMP:${fmtLocal(stamp)}`,
  ];
  if (t.dueHasTime) {
    lines.push(`DTSTART:${fmtLocal(d)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${fmtDate(d)}`);
  }
  if (t.repeat === 'daily') lines.push('RRULE:FREQ=DAILY');
  if (t.repeat === 'weekly') lines.push('RRULE:FREQ=WEEKLY');
  lines.push(
    `SUMMARY:${esc(t.text)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY',
    `DESCRIPTION:${esc(t.text)}`,
    t.dueHasTime ? 'TRIGGER:-PT0M' : 'TRIGGER:PT9H',  // all-day → aviso 9:00
    'END:VALARM', 'END:VEVENT', 'END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tarea.ics';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  toast('🗓 Abre el archivo y toca "Añadir al Calendario"', true);
}

/* ── rendering ── */
const $ = (s) => document.querySelector(s);
const listEl = $('#list');

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function cmp(a, b) {
  return (b.priority - a.priority) ||
    ((a.due ?? Infinity) - (b.due ?? Infinity)) ||
    (a.createdAt - b.createdAt);
}

function sectionOf(t, now) {
  if (t.done) return 'hechas';
  if (!t.due) return 'sin fecha';
  if (t.due < now) return 'vencidas';
  const diff = Math.round((startOfDay(t.due) - startOfDay(now)) / DAY);
  if (diff <= 0) return 'hoy';
  if (diff === 1) return 'mañana';
  if (diff <= 7) return 'esta semana';
  return 'después';
}

const SECTION_ORDER = ['vencidas', 'hoy', 'mañana', 'esta semana', 'después', 'sin fecha', 'hechas'];

function render() {
  listEl.textContent = '';
  const now = Date.now();

  const groups = {};
  for (const t of tasks) {
    const sec = sectionOf(t, now);
    (groups[sec] = groups[sec] || []).push(t);
  }
  for (const sec of Object.keys(groups)) groups[sec].sort(cmp);

  // day header: // lun 13 jul · 2 para hoy · 1 vencida
  const nHoy = (groups['hoy'] || []).length;
  const nVenc = (groups['vencidas'] || []).length;
  const dayStr = new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
  let head = `// ${dayStr}`;
  if (nVenc) head += ` · ${nVenc} vencida${nVenc === 1 ? '' : 's'}`;
  head += ` · ${nHoy} para hoy`;
  listEl.append(el('div', 'day-head', head));

  const sections = SECTION_ORDER.filter(sec => {
    if (!groups[sec] || !groups[sec].length) return false;
    if (filter === 'active') return sec !== 'hechas';
    if (filter === 'done') return sec === 'hechas';
    return true;
  });

  if (!sections.length) {
    listEl.append(el('div', 'empty',
      tasks.length ? '// nada que mostrar con este filtro'
                   : '// no hay tareas — agrega una arriba'));
  }

  let lineNo = 0;
  for (const sec of sections) {
    listEl.append(el('div', 'section-head', `// ${sec}`));
    for (const t of groups[sec]) {
      lineNo++;
      listEl.append(taskRow(t, lineNo, now));
    }
  }

  const open = tasks.filter(t => !t.done).length;
  $('#counts').textContent = `${open} pendiente${open === 1 ? '' : 's'} · ${tasks.length - open} hecha${tasks.length - open === 1 ? '' : 's'}`;
  $('#modelChip').textContent = localStorage.getItem(LS_KEY)
    ? '✦ ' + (localStorage.getItem(LS_MODEL) || DEFAULT_MODEL).replace('claude-', '')
    : '';
}

function taskRow(t, lineNo, now) {
  const row = el('div', 'task' + (t.done ? ' done' : ''));
  row.append(el('span', 'gutter', String(lineNo)));

  const check = el('button', 'check', t.done ? '[x]' : '[ ]');
  check.setAttribute('aria-label', t.done ? 'marcar pendiente' : 'marcar hecha');
  check.onclick = () => {
    if (t.repeat && !t.done) {
      advanceRepeat(t);
      toast(`↻ hecha por hoy — próxima: ${formatDue(t.due, t.dueHasTime)}`, true);
    } else {
      t.done = !t.done;
    }
    save(); render();
  };
  row.append(check);

  const body = el('div', 'task-body');
  body.append(el('div', 'task-text', t.text));

  const tags = el('div', 'tags');
  if (t.due) {
    const overdue = !t.done && t.due < now;
    tags.append(el('span', 'tag due' + (overdue ? ' overdue' : ''),
      '⏱ ' + formatDue(t.due, t.dueHasTime)));
  }
  if (t.repeat) tags.append(el('span', 'tag repeat', t.repeat === 'daily' ? '↻ diario' : '↻ semanal'));
  if (t.priority > 0) tags.append(el('span', 'tag p' + t.priority, '!p' + t.priority));
  if (tags.children.length) body.append(tags);

  if (t.reason) body.append(el('span', 'reason', '// ' + t.reason));

  if (t.subtasks && t.subtasks.length) {
    const subs = el('div', 'subtasks');
    t.subtasks.forEach((s) => {
      const srow = el('div', 'subtask' + (s.done ? ' done' : ''));
      srow.append(el('span', 'branch', '└'));
      const sc = el('button', 'check', s.done ? '[x]' : '[ ]');
      sc.onclick = () => { s.done = !s.done; save(); render(); };
      srow.append(sc);
      srow.append(el('span', 'sub-text', s.text));
      subs.append(srow);
    });
    body.append(subs);
  }
  row.append(body);

  const actions = el('div', 'task-actions');
  if (t.due && !t.done) {
    const cal = el('button', 'cal-btn', '🗓');
    cal.title = 'agregar al Calendario del iPhone (con aviso)';
    cal.onclick = () => downloadIcs(t);
    actions.append(cal);
  }
  const split = el('button', 'split-btn', '✦');
  split.title = 'dividir en subtareas (Claude)';
  split.onclick = () => breakdown(t, split);
  actions.append(split);
  const del = el('button', 'del-btn', '×');
  del.title = 'eliminar';
  del.onclick = () => { tasks = tasks.filter(x => x.id !== t.id); save(); render(); };
  actions.append(del);
  row.append(actions);

  return row;
}

/* ── toast ── */
let toastTimer;
function toast(msg, ok = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('ok', ok);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
}

/* ── Claude API ─────────────────────────────────────────────── */
async function callClaude(prompt, schema) {
  const key = localStorage.getItem(LS_KEY);
  if (!key) {
    $('#settingsDialog').showModal();
    throw new Error('Pega tu API key de Anthropic para usar las funciones ✦');
  }
  const model = localStorage.getItem(LS_MODEL) || DEFAULT_MODEL;

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        output_config: { format: { type: 'json_schema', schema } },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch {
    throw new Error('Sin conexión — no se pudo contactar a la API');
  }

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch {}
    if (res.status === 401) throw new Error('Clave inválida (401) — revisa tu API key en ⚙');
    if (res.status === 429) throw new Error('Límite de uso alcanzado (429) — espera un momento');
    if (res.status === 400) throw new Error('Solicitud rechazada (400): ' + detail);
    throw new Error(`Error ${res.status} de la API` + (detail ? ': ' + detail : ''));
  }

  const data = await res.json();
  if (data.stop_reason === 'refusal') throw new Error('Claude declinó esta solicitud');
  if (data.stop_reason === 'max_tokens') throw new Error('Respuesta truncada — intenta de nuevo');
  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock) throw new Error('Respuesta vacía de la API');
  return JSON.parse(textBlock.text);
}

const BREAKDOWN_SCHEMA = {
  type: 'object',
  properties: {
    subtasks: { type: 'array', items: { type: 'string' } },
  },
  required: ['subtasks'],
  additionalProperties: false,
};

async function breakdown(task, btn) {
  btn.disabled = true; btn.classList.add('busy');
  try {
    const out = await callClaude(
      `Divide esta tarea en subtareas pequeñas, concretas y accionables (entre 2 y 6). ` +
      `Responde en el mismo idioma de la tarea. Tarea: "${task.text}"`,
      BREAKDOWN_SCHEMA);
    task.subtasks = (out.subtasks || []).slice(0, 8).map(s => ({ id: uid(), text: String(s), done: false }));
    save(); render();
    toast(`✦ ${task.subtasks.length} subtareas generadas`, true);
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false; btn.classList.remove('busy');
  }
}

const PRIORITIZE_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          priority: { type: 'integer', enum: [0, 1, 2, 3] },
          reason: { type: 'string' },
        },
        required: ['id', 'priority', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['tasks'],
  additionalProperties: false,
};

async function prioritize() {
  const open = tasks.filter(t => !t.done);
  if (!open.length) { toast('No hay tareas pendientes que priorizar'); return; }
  const btn = $('#prioritizeBtn');
  btn.disabled = true; btn.classList.add('busy');
  const original = btn.textContent;
  btn.textContent = '✦ pensando…';
  try {
    const payload = open.map(t => ({
      id: t.id, text: t.text,
      due: t.due ? new Date(t.due).toISOString() : null,
      priority: t.priority,
    }));
    const out = await callClaude(
      `Eres un asistente de productividad. Ahora mismo es ${new Date().toString()}. ` +
      `Estas son mis tareas pendientes (JSON):\n${JSON.stringify(payload)}\n` +
      `Asigna a CADA tarea una prioridad de 0 (baja) a 3 (urgente) considerando fechas límite, ` +
      `urgencia implícita y esfuerzo. Da una razón breve (máx 10 palabras, en español) por tarea. ` +
      `Devuelve todas las tareas con su id original.`,
      PRIORITIZE_SCHEMA);
    let applied = 0;
    for (const r of out.tasks || []) {
      const t = tasks.find(x => x.id === r.id);
      if (t) { t.priority = Math.max(0, Math.min(3, r.priority | 0)); t.reason = r.reason; applied++; }
    }
    save(); render();
    toast(`✦ ${applied} tareas priorizadas`, true);
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false; btn.classList.remove('busy');
    btn.textContent = original;
  }
}

/* ── events ── */
$('#addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#taskInput');
  const raw = input.value.trim();
  if (!raw) return;
  const parsed = parseInput(raw);
  if (!parsed.text) return;
  tasks.push({
    id: uid(),
    text: parsed.text,
    done: false,
    priority: parsed.priority,
    due: parsed.due,
    dueHasTime: parsed.dueHasTime,
    repeat: parsed.repeat,
    subtasks: [],
    createdAt: Date.now(),
  });
  input.value = '';
  save(); render();
});

/* paste a whole list (from the Claude app or anywhere) → bulk import */
$('#taskInput').addEventListener('paste', (e) => {
  const txt = (e.clipboardData || window.clipboardData)?.getData('text') || '';
  const trimmed = txt.trim();
  if (!trimmed) return;
  let items = null;
  if (trimmed.startsWith('[')) {
    try { const j = JSON.parse(trimmed); if (Array.isArray(j)) items = j; } catch { }
  }
  if (!items && trimmed.includes('\n')) items = trimmed.split('\n');
  if (items) {
    e.preventDefault();
    $('#taskInput').value = '';
    const n = importTasks(items);
    toast(n ? `✦ ${n} tarea${n === 1 ? '' : 's'} importada${n === 1 ? '' : 's'}` : 'Nada nuevo que importar', n > 0);
  }
});

document.querySelectorAll('.filter').forEach(b => {
  b.addEventListener('click', () => {
    filter = b.dataset.filter;
    document.querySelectorAll('.filter').forEach(x => x.classList.toggle('active', x === b));
    render();
  });
});

$('#prioritizeBtn').addEventListener('click', prioritize);

/* mode chip (vim-style) */
const modeChip = $('#modeChip');
$('#taskInput').addEventListener('focus', () => { modeChip.textContent = 'INSERT'; modeChip.classList.add('insert'); });
$('#taskInput').addEventListener('blur', () => { modeChip.textContent = 'NORMAL'; modeChip.classList.remove('insert'); });

/* ── settings ── */
const dialog = $('#settingsDialog');
$('#settingsBtn').addEventListener('click', () => {
  $('#apiKeyInput').value = localStorage.getItem(LS_KEY) || '';
  $('#modelSelect').value = localStorage.getItem(LS_MODEL) || DEFAULT_MODEL;
  dialog.showModal();
});
dialog.addEventListener('close', () => {
  if (dialog.returnValue === 'save') {
    const key = $('#apiKeyInput').value.trim();
    if (key) localStorage.setItem(LS_KEY, key);
    localStorage.setItem(LS_MODEL, $('#modelSelect').value);
    toast('Configuración guardada', true);
  }
  render();
});
$('#removeKeyBtn').addEventListener('click', () => {
  localStorage.removeItem(LS_KEY);
  $('#apiKeyInput').value = '';
  toast('Clave eliminada de este dispositivo', true);
  render();
});
$('#clearTasksBtn').addEventListener('click', () => {
  if (confirm('¿Borrar TODAS las tareas? Esto no se puede deshacer.')) {
    tasks = []; save(); render();
    dialog.close();
  }
});

/* ── init ── */
render();
importFromHash();
window.addEventListener('hashchange', importFromHash);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
