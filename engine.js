"use strict";

globalThis.Lab = (() => {
  const delimiters = [",", ";", "\t"];
  const missing = value => String(value ?? "").trim() === "";

  function detectDelimiter(text) {
    const counts = [0, 0, 0];
    let quoted = false;
    for (const char of text) {
      if (char === '"') quoted = !quoted;
      if (!quoted && (char === "\n" || char === "\r")) break;
      const index = delimiters.indexOf(char);
      if (!quoted && index >= 0) counts[index]++;
    }
    return delimiters[counts.indexOf(Math.max(...counts))];
  }

  function parseCSV(raw, separator) {
    const text = raw.replace(/^\uFEFF/, "");
    if (!text.trim()) throw new Error("Файл пуст.");
    const delimiter = separator || detectDelimiter(text);
    if (!delimiters.includes(delimiter)) throw new Error("Неподдерживаемый разделитель.");
    const records = [];
    let row = [], value = "", state = "field";
    function field() { row.push(value); value = ""; state = "field"; }
    function record() {
      field();
      if (row.length > 1 || !missing(row[0])) records.push(row);
      row = [];
      if (records.length > 100001) throw new Error("Лимит — 100 000 строк данных.");
    }
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (state === "quoted") {
        if (ch !== '"') value += ch;
        else if (text[i + 1] === '"') { value += '"'; i++; }
        else state = "closed";
      } else if (ch === delimiter) field();
      else if (ch === "\r" || ch === "\n") {
        record();
        if (ch === "\r" && text[i + 1] === "\n") i++;
      } else if (ch === '"' && state === "field" && !value) state = "quoted";
      else if (state === "closed" || ch === '"') {
        throw new Error("Неверные кавычки в строке данных " + records.length + ".");
      } else value += ch;
    }
    if (state === "quoted") throw new Error("В файле есть незакрытое поле в кавычках.");
    record();
    if (!records.length) throw new Error("Нет заголовков.");
    const [head, ...rows] = records;
    const headers = head.map(value => value.trim());
    if (headers.length > 100) throw new Error("Лимит — 100 столбцов.");
    if (headers.some(missing) || new Set(headers).size !== headers.length) {
      throw new Error("Заголовки должны быть заполнены и уникальны.");
    }
    if (!rows.length) throw new Error("Добавьте хотя бы одну строку данных после заголовка.");
    const invalid = rows.findIndex(row => row.length !== headers.length);
    if (invalid >= 0) throw new Error("Число полей отличается от заголовка в строке данных " + (invalid + 1) + ".");
    return {headers, rows, delimiter};
  }

  function numeric(value) {
    const text = String(value).trim().replace(/[\u00A0\u202F]/g, " ");
    if (/^[+-]?0\d+$/.test(text)) return null;  // Preserve leading-zero IDs.
    const compact = text.replace(/(?<=\d) (?=\d{3}(?:\D|$))/g, "");
    if (!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(compact)) return null;
    const valueNumber = Number(compact.replace(",", "."));
    return Number.isFinite(valueNumber) ? valueNumber : null;
  }

  function dateKey(value) {
    const match = /^(\d{4})-(\d\d)-(\d\d)$/.exec(value);
    if (!match) return null;
    const t = Date.parse(value + "T00:00:00Z");
    return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value ? value : null;
  }

  function profile(headers, rows) {
    const columns = headers.map((name, index) => {
      let blanks = 0, count = 0, dates = 0, numbers = 0, sum = 0, min = Infinity, max = -Infinity;
      const values = new Map();
      for (const row of rows) {
        const value = row[index].trim();
        if (missing(value)) { blanks++; continue; }
        count++;
        values.set(value, (values.get(value) || 0) + 1);
        if (dateKey(value)) dates++;
        const n = numeric(value);
        if (n !== null) { numbers++; sum += n; min = Math.min(min, n); max = Math.max(max, n); }
      }
      const type = !count ? "empty" : dates === count ? "date" : numbers === count ? "number" : "text";
      const top = [...values].sort((a,b) => b[1] - a[1]).slice(0, 5);
      return {name, index, blanks, distinct: values.size, type, top,
              mean: numbers ? sum / numbers : null, min: numbers ? min : null, max: numbers ? max : null};
    });
    let duplicates = 0;
    const seen = new Set();
    for (const row of rows) {
      const key = JSON.stringify(row);
      if (seen.has(key)) duplicates++;
      else seen.add(key);
    }
    return {columns, duplicates, complete: rows.filter(row => row.every(v => !missing(v))).length,
            missing: columns.reduce((sum, c) => sum + c.blanks, 0)};
  }

  function filterRows(rows, filters, query = "") {
    const needle = query.trim().toLocaleLowerCase();
    return rows.filter(row => filters.every(({column, operator, value}) => {
      const cell = row[column].trim();
      if (operator === "blank") return missing(cell);
      if (operator === "equals") return cell === value;
      if (operator === "contains") return cell.toLocaleLowerCase().includes(value.toLocaleLowerCase());
      const left = numeric(cell), right = numeric(value);
      if (left === null || right === null) return false;
      return operator === "gte" ? left >= right : left <= right;
    }) && (!needle || row.some(value => value.toLocaleLowerCase().includes(needle))));
  }

  function aggregate(rows, groupBy = [], measure = null, operation = "count") {
    const groups = new Map();
    for (const row of rows) {
      const key = groupBy.map(index => row[index].trim());
      const id = JSON.stringify(key);
      if (!groups.has(id)) groups.set(id, {key, rows: 0, numericCount: 0, sum: 0, min: Infinity, max: -Infinity});
      const group = groups.get(id);
      group.rows++;
      const n = measure === null ? null : numeric(row[measure]);
      if (n !== null) {
        group.numericCount++;
        group.sum += n;
        group.min = Math.min(n, group.min);
        group.max = Math.max(n, group.max);
      }
    }
    return [...groups.values()].map(group => {
      const {numericCount, sum, min, max} = group;
      const value = operation === "count" ? group.rows : !numericCount ? null :
        ({sum, average: sum / numericCount, min, max})[operation];
      return {key: group.key, rows: group.rows, value};
    }).sort((a,b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || JSON.stringify(a.key).localeCompare(JSON.stringify(b.key)));
  }

  function wilson(k, n) {
    const z = 1.959963984540054, p = k / n, z2 = z * z;
    const center = (p + z2 / (2 * n)) / (1 + z2 / n);
    const width = z * Math.sqrt(p * (1-p) / n + z2 / (4*n*n)) / (1 + z2 / n);
    return [center - width, center + width];
  }

  function interval(a, b, metric) {
    const pa = a[metric] / a.n, pb = b[metric] / b.n, diff = pb - pa;
    const [la, ua] = wilson(a[metric], a.n), [lb, ub] = wilson(b[metric], b.n);
    return {a:pa, b:pb, diff, low:diff - Math.hypot(pb-lb, ua-pa), high:diff + Math.hypot(ub-pb, pa-la)};
  }

  function erfc(value) {
    if (!value) return 1;
    const t = 1 / (1 + .3275911 * value);
    return (((((1.061405429*t - 1.453152027)*t + 1.421413741)*t - .284496736)*t + .254829592)*t)
      * Math.exp(-value * value);
  }

  function runExperiment(rows, options) {
    const {id, variant, outcome, guard, control, treatment, split, minGain, maxGuard} = options;
    if (![id, variant, outcome].every(index => Number.isInteger(index) && index >= 0) ||
        new Set([id, variant, outcome, ...(guard >= 0 ? [guard] : [])]).size !== (guard >= 0 ? 4 : 3)) {
      throw new Error("Укажите разные столбцы ID, варианта и метрик.");
    }
    if (!control || !treatment || control === treatment || !(split > .01 && split < .99)) {
      throw new Error("Укажите разные группы и ожидаемую долю A от 2% до 98%.");
    }
    if (![minGain, maxGuard].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
      throw new Error("Пороги должны быть от 0 до 100 п.п.");
    }
    const groups = new Map([[control, {n:0, paid:0, risk:0}], [treatment, {n:0, paid:0, risk:0}]]);
    const unique = new Set();
    let excluded = 0;
    for (const row of rows) {
      const group = groups.get(row[variant]?.trim());
      if (!group) { excluded++; continue; }
      const key = row[id]?.trim();
      if (missing(key) || unique.has(key)) throw new Error("В выбранных группах ID должны быть заполнены и уникальны.");
      unique.add(key);
      const paid = row[outcome]?.trim(), risk = guard >= 0 ? row[guard]?.trim() : "0";
      if (!["0","1"].includes(paid) || !["0","1"].includes(risk)) {
        throw new Error("Столбцы метрик должны содержать ровно 0 или 1 в каждой строке выбранных групп.");
      }
      group.n++; group.paid += Number(paid); group.risk += Number(risk);
    }
    const a = groups.get(control), b = groups.get(treatment), n = a.n + b.n;
    if (!a.n || !b.n) throw new Error("В обеих группах должны быть наблюдения.");
    const expected = n * split;
    if (Math.min(expected, n - expected) < 5) throw new Error("Для проверки SRM нужно не менее 5 ожидаемых наблюдений в каждой группе.");
    const srm = erfc(Math.abs(a.n - expected) / Math.sqrt(2 * n * split * (1 - split)));
    const primary = interval(a,b,"paid"), guardrail = guard >= 0 ? interval(a,b,"risk") : null;
    const decision = srm < .001 ? "srm" : guardrail && guardrail.high >= maxGuard ? "guard" :
      primary.low <= minGain ? "hold" : guardrail ? "release" : "positive";
    return {a,b,srm,primary,guardrail,decision,excluded};
  }

  function exportCSV(headers, rows) {
    function escape(value) {
      let text = String(value ?? "");
      if (/^[\s]*[=+@\-\t\r]/.test(text) && numeric(text) === null) text = "'" + text;
      return '"' + text.replaceAll('"', '""') + '"';
    }
    return "\uFEFF" + [headers, ...rows].map(row => row.map(escape).join(";")).join("\r\n");
  }

  function demo() {
    const headers = ["session_id","Дата","Канал","Устройство","Город","Группа","Покупка","Ошибка оплаты","Выручка"];
    const rows = [];
    let state = 671389;
    const next = () => { state = (Math.imul(state,1664525) + 1013904223) >>> 0; return state / 4294967296; };
    const channels = ["Органика","Поиск","Реклама","Рефералы"];
    const cities = ["Москва","Санкт-Петербург","Казань","Екатеринбург"];
    for (let index = 0; index < 4800; index++) {
      const day = Math.floor(index / 160);
      const variant = next() < .50 ? "A" : "B";
      const device = next() < .72 ? "Приложение" : "Веб";
      const channel = channels[Math.floor(next() * channels.length)];
      const city = next() < .028 ? "" : cities[Math.floor(next() * cities.length)];
      const paid = Number(next() < .28 + (variant === "B" ? .045 : 0) + (day % 7 < 5 ? .06 : 0) + day * .001);
      const error = Number(next() < (variant === "B" ? .041 : .021));
      const amount = paid ? Math.round(800 + 4900 * next() * next()) : 0;
      rows.push(["S" + (index + 1), "2026-10-" + String(day + 1).padStart(2,"0"), channel,
                 device, city, variant, String(paid), String(error), String(amount)]);
    }
    return {headers, rows, name:"Покупки маркетплейса", demo:true};
  }

  return {parseCSV, numeric, dateKey, profile, filterRows, aggregate, runExperiment, exportCSV, demo};
})();
