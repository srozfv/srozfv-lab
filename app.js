"use strict";

const lab = globalThis.Lab;
const main = document.querySelector("#main");
const $ = selector => document.querySelector(selector);
const pageNames = {overview:"Обзор",dataset:"Качество данных",explore:"Срезы",experiment:"A/B-тесты"};
const ops = {count:"Число строк",sum:"Сумма",average:"Среднее",min:"Минимум",max:"Максимум"};
const types = {date:"Дата",number:"Число",text:"Текст",empty:"Пустой"};
const filterOps = {equals:"Равно",contains:"Содержит",gte:"Не меньше",lte:"Не больше",blank:"Пустое"};
const fmt = new Intl.NumberFormat("ru-RU",{maximumFractionDigits:2});
const fmtInt = new Intl.NumberFormat("ru-RU",{maximumFractionDigits:0});
const number = value => value === null ? "—" : Number.isFinite(value) ? fmt.format(value) : "∞";
const percent = value => number(value * 100) + "%";
const pp = value => (value > 0 ? "+" : "") + number(value * 100) + " п.п.";
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const opt = (value, label, selected) => '<option value="' + esc(value) + '"' + (String(selected) === String(value) ? " selected" : "") + ">" + esc(label) + "</option>";
const state = {page:"overview"};
let chartObserver, noticeTimer, draggedFile, importGeneration = 0;

function switchData(data) {
  const profile = lab.profile(data.headers, data.rows);
  const numeric = profile.columns.filter(c => c.type === "number");
  const groups = profile.columns.filter(c => c.type === "text" && c.distinct > 1 && c.distinct <= 30);
  Object.assign(state, {data, profile, filters:[], query:"", rowPage:0, groupPage:0, sort:null,
    slice:{first:data.demo ? 2 : groups[0]?.index ?? -1, second:-1, measure:data.demo ? 8 : numeric[0]?.index ?? -1,
      operation:numeric.length ? "sum" : "count"},
    ab:{id:0, variant:data.demo ? 5 : -1, outcome:data.demo ? 6 : -1, guard:data.demo ? 7 : -1,
      control:"A", treatment:"B", split:50, minGain:.5, maxGuard:.4},
    result:null, experimentError:""});
  if (data.demo) calculate();
}

function toast(message) {
  const notice = $("#notice");
  clearTimeout(noticeTimer);
  notice.textContent = message; notice.hidden = false;
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 2500);
}

function goto(page) {
  state.page = page;
  render();
  main.focus({preventScroll:true});
  window.scrollTo(0,0);
}

function table(headers, rows, label, {sort=false} = {}) {
  if (!rows.length) return '<div class="empty">По текущим условиям строк нет.</div>';
  return '<div class="scroll" tabindex="0" role="region" aria-label="' + esc(label) + '"><table><thead><tr>' +
    headers.map((name,index) => {
      const active = sort && state.sort?.column === index;
      const indicator = active ? (state.sort.direction > 0 ? " ↑" : " ↓") : "";
      return '<th scope="col"' + (active ? ' aria-sort="' + (state.sort.direction > 0 ? "ascending" : "descending") + '"' : "") +
        ">" + (sort ? '<button class="sort" data-sort="' + index + '">' + esc(name + indicator) + "</button>" : esc(name)) + "</th>";
    }).join("") + "</tr></thead><tbody>" +
    rows.map(row => "<tr>" + row.map(value => {
      const text = String(value ?? "");
      return text ? '<td title="' + esc(text) + '">' + esc(text) + "</td>" : '<td class="blank">—</td>';
    }).join("") + "</tr>").join("") + "</tbody></table></div>";
}

function panel(title, subtitle, content, action="", classes="") {
  return '<section class="panel ' + classes + '"><div class="panel-head"><div><h2>' + esc(title) + "</h2>" +
    (subtitle ? "<p>" + esc(subtitle) + "</p>" : "") + "</div>" + action + "</div>" + content + "</section>";
}

function header(title, subtitle, action="") {
  return '<div class="page-head"><div><h1>' + esc(title) + "</h1><p>" + esc(subtitle) + "</p></div>" + action + "</div>";
}

function card(icon,title,value,sub) {
  return '<div class="card"><div class="card-title"><span class="metric-icon" aria-hidden="true">' + icon +
    "</span>" + esc(title) + '</div><div class="value">' + esc(value) + "</div><small>" + esc(sub) + "</small></div>";
}

function overview() {
  const {data,profile} = state;
  const date = profile.columns.find(col => col.type === "date");
  const dimension = data.demo ? profile.columns[2] : profile.columns.find(col => col.type === "text" && col.distinct > 1 && col.distinct <= 40);
  const num = data.demo ? profile.columns[8] : profile.columns.find(col => col.type === "number" && !/(^id$|_id$|^код)/i.test(col.name));
  const trend = date ? lab.aggregate(data.rows, [date.index], num?.index ?? null, num ? "sum" : "count")
    .filter(point => lab.dateKey(point.key[0]) && Number.isFinite(point.value))
    .sort((a,b) => a.key[0].localeCompare(b.key[0])).slice(-60) : [];
  const categories = dimension ? lab.aggregate(data.rows,[dimension.index],null,"count").slice(0,6) : [];
  const quality = profile.columns.filter(c => c.blanks).sort((a,b) => b.blanks - a.blanks).slice(0,5);
  const emptyShare = profile.missing / (data.rows.length * data.headers.length);
  const html = header("Обзор данных", "Профиль таблицы и распределение показателей.") +
    '<div class="dataset-banner"><div class="dataset-id"><span class="file-icon" aria-hidden="true">▤</span><div><strong>' +
    esc(data.name) + "</strong><small>" + number(data.rows.length) + " строк · " + data.headers.length +
    ' столбцов</small></div></div><span class="pill">' + (data.demo ? "Синтетические данные" : "Загруженный файл") + "</span></div>" +
    '<div class="cards">' + card("▥","Строки",number(data.rows.length),"В исходной таблице") +
    card("▤","Столбцы",number(data.headers.length), profile.columns.filter(c => c.type === "number").length + " числовых") +
    card("◎","Пропуски",percent(emptyShare),number(profile.missing) + " пустых ячеек") +
    card("◈","Дубликаты",number(profile.duplicates),"Полностью повторяющиеся строки") + "</div>" +
    '<div class="chart-grid">' +
    panel(num ? "Динамика · " + num.name : "Динамика строк", date ? "По полю «" + date.name + "» · до 60 последних дат" : "Для графика нужно поле даты ГГГГ-ММ-ДД.",
      trend.length ? '<div class="chart-box"><canvas id="trend" aria-label="Линейный график по датам" role="img"></canvas></div><details class="fine"><summary>Значения по датам</summary>' +
      table([date.name,num?.name || "Строки"],trend.map(p => [p.key[0],number(p.value)]),"Данные графика") + "</details>" :
      '<div class="empty">Нет календарного ряда.</div>',trend.length && num && data.demo ? '<span class="pill">₽</span>' : "") +
    panel("Распределение строк",dimension ? "Поле «" + dimension.name + "» · до 6 категорий" : "Для графика нужно категориальное поле.",
      categories.length ? bars(categories, point => point.key[0]) : '<div class="empty">Нет подходящих категорий.</div>') + "</div>" +
    panel("Пропуски по столбцам","До пяти столбцов с наибольшим числом пропусков.",
      quality.length ? table(["Столбец","Пропуски","Доля"],quality.map(c => [c.name,number(c.blanks),percent(c.blanks/data.rows.length)]),"Пропуски") :
      '<span class="pill ok">Пустых ячеек нет</span>',
      '<button class="button" data-goto="dataset">Открыть профиль →</button>');
  return {html,trend};
}

function bars(points,label) {
  const present = points.filter(p => p.value !== null && Number.isFinite(p.value));
  const max = Math.max(...present.map(p => Math.abs(p.value)),1);
  if (!present.length) return '<div class="empty">Нет числовых значений.</div>';
  return '<div class="bars">' + present.map(point => '<div class="bar-row"><div class="bar-meta"><span>' +
    esc(label(point) || "Пусто") + "</span><strong>" + esc(number(point.value)) +
    '</strong></div><div class="bar-track" aria-hidden="true"><i style="width:' +
    (Math.abs(point.value)/max*100).toFixed(2) + '%"></i></div></div>').join("") + "</div>";
}

function draw(canvas,trend) {
  if (!canvas || !trend.length) return;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (width < 80 || height < 80) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio; canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio,ratio);
  const values = trend.map(point => point.value ?? 0);
  const min = Math.min(0,...values), max = Math.max(...values, min + 1);
  const left = 55, bottom = height - 31, right = width - 12, top = 12;
  const x = i => trend.length === 1 ? (left+right)/2 : left + i*(right-left)/(trend.length-1);
  const y = v => bottom - (v-min)/(max-min)*(bottom-top);
  ctx.font = '10px "Segoe UI", sans-serif';
  ctx.strokeStyle = "#eae6f2"; ctx.fillStyle = "#6a617d"; ctx.lineWidth=1;
  ctx.textAlign = "right";
  for (let i=0;i<=4;i++) {
    const n=min+(max-min)*i/4, v=y(n);
    ctx.beginPath(); ctx.moveTo(left,v); ctx.lineTo(right,v); ctx.stroke();
    const compact = new Intl.NumberFormat("ru-RU",{notation:"compact",maximumFractionDigits:1}).format(n);
    ctx.fillText(compact,left-7,v+3);
  }
  const positions = [...new Set(Array.from({length: width<420 ? 4 : 6},(_,i) =>
    Math.round(i*(trend.length-1)/(width<420 ? 3 : 5))))];
  ctx.textAlign = "center";
  for (const i of positions) ctx.fillText(trend[i].key[0].slice(5).split("-").reverse().join("."),x(i),bottom+19);
  const gradient = ctx.createLinearGradient(0,top,0,bottom);
  gradient.addColorStop(0,"#a384fb66"); gradient.addColorStop(1,"#a384fb08");
  ctx.beginPath(); ctx.moveTo(x(0),bottom);
  values.forEach((v,i) => ctx.lineTo(x(i),y(v)));
  ctx.lineTo(x(values.length-1),bottom); ctx.closePath(); ctx.fillStyle=gradient; ctx.fill();
  ctx.beginPath(); values.forEach((v,i) => i ? ctx.lineTo(x(i),y(v)) : ctx.moveTo(x(i),y(v)));
  ctx.lineWidth=2.7; ctx.lineJoin="round"; ctx.strokeStyle="#7147df"; ctx.stroke();
  if (values.length <= 32) {
    ctx.fillStyle="#7147df";
    values.forEach((v,i) => {ctx.beginPath(); ctx.arc(x(i),y(v),2.5,0,2*Math.PI); ctx.fill();});
  }
}

function columnOptions(value, emptyLabel) {
  return (emptyLabel ? opt(-1,emptyLabel,value) : "") +
    state.data.headers.map((name,index) => opt(index,name,value)).join("");
}

function filters() {
  return panel("Фильтры","Условия объединяются через И. Применяются к таблице строк, срезам и их экспорту.",
    '<form id="filters" class="filter-box"><label>Столбец<select id="filter-column">' + columnOptions(0) +
    '</select></label><label>Условие<select id="filter-op">' +
    Object.entries(filterOps).map(([value,label]) => opt(value,label,"equals")).join("") +
    '</select></label><label>Значение<input id="filter-value" autocomplete="off"></label>' +
    '<button class="button" type="submit">Добавить</button></form><div class="filter-list">' +
    state.filters.map((f,i) => '<button class="chip" data-remove="' + i + '" aria-label="Удалить фильтр ' +
      esc(state.data.headers[f.column]) + '">' + esc(state.data.headers[f.column]) + " · " +
      esc(filterOps[f.operator]) + (f.operator === "blank" ? "" : " " + esc(f.value)) + " ×</button>").join("") +
    (state.filters.length ? '<button class="chip" id="clear-filters">Сбросить все</button>' : "") + "</div>","","gap");
}

function selectedRows() { return lab.filterRows(state.data.rows,state.filters,state.query); }

function displayRows() {
  const rows = selectedRows();
  if (state.sort) {
    const {column,direction} = state.sort;
    const isNumber = state.profile.columns[column].type === "number";
    rows.sort((a,b) => direction*(isNumber ?
      (lab.numeric(a[column]) ?? -Infinity) - (lab.numeric(b[column]) ?? -Infinity) :
      a[column].localeCompare(b[column],"ru",{numeric:true})));
  }
  return rows;
}

function pager(kind,index,count,step) {
  const end = Math.max(0,Math.ceil(count/step)-1);
  return '<div class="table-foot"><span>' + (count ? number(index*step+1) + "–" + number(Math.min(count,(index+1)*step)) : "0") +
    " из " + number(count) + '</span><div class="inline"><button class="button" data-' + kind + '="-1"' +
    (!index ? " disabled" : "") + '>← Назад</button><button class="button" data-' + kind + '="1"' +
    (index >= end ? " disabled" : "") + ">Далее →</button></div></div>";
}

function dataset() {
  const {data,profile} = state;
  const colRows = profile.columns.map(c => [c.name,types[c.type],number(c.distinct),number(c.blanks),
    percent(c.blanks/data.rows.length),c.type === "number" ? number(c.min) : "—",
    c.type === "number" ? number(c.max) : "—", c.top.map(([value,count]) => value + " (" + count + ")").join(", ")]);
  return header("Качество данных","Профиль полей, повторяющиеся строки и просмотр выборки.") +
    '<div class="cards">' + card("▥","Строки",number(data.rows.length),data.name) +
    card("✓","Полные строки",number(profile.complete),"Без пустых полей") +
    card("◎","Пропуски",number(profile.missing),"Пустые ячейки") +
    card("◈","Дубликаты",number(profile.duplicates),"Повторы после первого вхождения") + "</div>" +
    panel("Профиль столбцов","По всему исходному файлу.",
      table(["Поле","Тип","Уникальных","Пустых","Доля пустых","Мин","Макс","Частые значения"],colRows,"Профиль столбцов"),
      '<button class="button" id="profile-export">Скачать профиль</button>',"gap") +
    filters() +
    panel("Строки таблицы","Нажмите на заголовок столбца для сортировки.",
      '<label class="gap">Поиск по всем полям<input id="row-query" placeholder="Введите значение" value="' +
      esc(state.query) + '"></label><div id="row-results"></div>',
      '<button class="button" id="rows-export">Скачать выборку</button>');
}

function drawRows() {
  const rows = displayRows(), step = 30;
  state.rowPage = Math.min(state.rowPage,Math.max(0,Math.ceil(rows.length/step)-1));
  $("#row-results").innerHTML = table(state.data.headers,rows.slice(state.rowPage*step,(state.rowPage+1)*step),
    "Строки таблицы",{sort:true}) + pager("row-page",state.rowPage,rows.length,step);
}

function getGroups() {
  const {first,second,measure,operation} = state.slice;
  const dimensions = [...new Set([first,second].filter(i => i >= 0))];
  const rows = lab.filterRows(state.data.rows,state.filters);
  return {dimensions, list:lab.aggregate(rows, dimensions, measure >= 0 ? measure : null,operation), rows:rows.length};
}

function explore() {
  const group = state.slice;
  return header("Срезы","Сгруппируйте строки по двум полям и сравните результаты.") +
    filters() + panel("Настроить срез","Пустая группировка даёт общий итог.",
      '<div class="inputs"><label>Группировка<select data-slice="first">' + columnOptions(group.first,"Без группировки") +
      '</select></label><label>Второе поле<select data-slice="second">' + columnOptions(group.second,"Без второго поля") +
      '</select></label><label>Операция<select data-slice="operation">' +
      Object.entries(ops).map(([v,label]) => opt(v,label,group.operation)).join("") +
      '</select></label><label>Числовое поле<select data-slice="measure"' + (group.operation === "count" ? " disabled" : "") + ">" +
      columnOptions(group.measure,"Выберите поле") + '</select></label></div>',"","gap") + '<div id="group-results"></div>';
}

function drawGroups() {
  const {list,dimensions,rows} = getGroups();
  const {operation,measure} = state.slice;
  const step = 25;
  state.groupPage = Math.min(state.groupPage,Math.max(0,Math.ceil(list.length/step)-1));
  const measureName = operation === "count" ? ops.count : ops[operation] + " · " + (state.data.headers[measure] || "поле не выбрано");
  const groupLabel = point => point.key.map(value => value || "Пусто").join(" / ") || "Все строки";
  $("#group-results").innerHTML = (operation !== "count" && measure < 0 ? '<p class="error">Выберите числовое поле.</p>' : "") +
    panel("Первые группы",measureName + " · шкала по абсолютной величине",bars(list.slice(0,8),groupLabel),"","gap") +
    panel("Результат",number(rows) + " строк · " + number(list.length) + " групп",
      table([...dimensions.map(i => state.data.headers[i]),"Строк в группе","Значение"],
        list.slice(state.groupPage*step,(state.groupPage+1)*step).map(p => [...p.key,number(p.rows),number(p.value)]),"Итог среза") +
      pager("group-page",state.groupPage,list.length,step),'<button class="button" id="groups-export">Скачать срез</button>');
}

const decisions = {
  guard:["Удержать релиз","Верхняя граница эффекта по защитной метрике достигает допустимого порога.","warn"],
  srm:["Проверить распределение","SRM p-value ниже 0,001. Проверьте рандомизацию и полноту данных перед интерпретацией.","bad"],
  hold:["Сохранить контроль","Нижняя граница эффекта недостаточна для заданного минимального прироста.","warn"],
  positive:["Прирост подтверждён","Минимальный эффект пройден. Для решения о релизе добавьте защитную метрику.","ok"],
  release:["Рассмотреть постепенный релиз","Нижняя граница эффекта выше минимума, защитная метрика ниже порога.","ok"]
};

function abInput(key,label,type="text") {
  const limits = key === "split" ? ' min="2" max="98"' : type === "number" ? ' min="0" max="100"' : "";
  return "<label>" + esc(label) + '<input data-ab="' + key + '" type="' + type + '"' + limits +
    (type === "number" ? ' step="any" required' : " required") + ' value="' + esc(state.ab[key]) + '"></label>';
}
function abSelect(key,label,empty) {
  return "<label>" + esc(label) + '<select data-ab="' + key + '">' + columnOptions(state.ab[key],empty) + "</select></label>";
}

function experiment() {
  return header("A/B-тесты","Сравнение двух независимых групп по бинарным метрикам.") +
    panel("Настройки эксперимента","Используется весь файл. Каждая строка — одна единица рандомизации.",
      '<form id="ab-form"><div class="inputs">' + abSelect("id","ID наблюдения","Выберите ID") +
      abSelect("variant","Группа","Выберите группу") + abSelect("outcome","Основная метрика 0 / 1","Выберите метрику") +
      abSelect("guard","Защитная метрика 0 / 1","Без защитной метрики") +
      abInput("control","Значение группы A") + abInput("treatment","Значение группы B") +
      abInput("split","Ожидаемая доля A, %","number") + abInput("minGain","Минимальный прирост, п.п.","number") +
      abInput("maxGuard","Максимальный рост риска, п.п.","number") +
      '</div><div class="dialog-actions"><button class="primary">Рассчитать</button></div></form>',"","gap") +
    '<div id="ab-result"></div>' +
    panel("Методика","",
      '<details class="experiment-notes"><summary>Как интерпретировать результат</summary><p>Разница долей B − A. ' +
      '95% доверительный интервал разницы рассчитан методом Ньюкомба на основе интервалов Уилсона. ' +
      'SRM проверяет распределение групп критерием χ². Для решения используются обе границы и заданные пороги.</p>' +
      '<p>Подготовьте данные с одинаковым полным окном наблюдения и включите назначенных участников без события как 0. ' +
      'Другие группы исключаются из расчёта. Для редких событий или малых выборок оцените мощность и пригодность метода отдельно.</p></details>');
}

function calculate() {
  try {
    const ab = state.ab;
    state.result = lab.runExperiment(state.data.rows,{...ab, control:ab.control.trim(), treatment:ab.treatment.trim(),
      split:ab.split/100,minGain:ab.minGain/100,maxGuard:ab.maxGuard/100});
    state.experimentError = "";
  } catch (e) {
    state.result = null; state.experimentError = e.message;
  }
}

function abRows(result) {
  const ab = state.ab;
  const items = [[state.data.headers[ab.outcome],result.primary]];
  if (result.guardrail) items.push([state.data.headers[ab.guard],result.guardrail]);
  return items;
}

function drawExperiment() {
  const {result,experimentError} = state;
  const section = $("#ab-result");
  if (experimentError) {
    section.innerHTML = '<p class="error" role="alert">' + esc(experimentError) + "</p>";
    return;
  }
  if (!result) {
    section.innerHTML = '<p class="empty">Заполните настройки и рассчитайте результат.</p>';
    return;
  }
  const [title,desc,tone] = decisions[result.decision];
  const ab = state.ab;
  const rows = abRows(result).map(([name,m]) => [name,percent(m.a),percent(m.b),pp(m.diff),pp(m.low)+" … "+pp(m.high)]);
  const p = result.srm < .0001 ? "< 0,0001" : result.srm.toLocaleString("ru-RU",{maximumFractionDigits:4});
  section.innerHTML = panel("Результат","A · " + fmtInt.format(result.a.n) + " наблюдений  |  B · " +
    fmtInt.format(result.b.n) + "  |  SRM p = " + p + "  |  исключено " + number(result.excluded),
    '<div class="decision ' + tone + '"><strong>' + esc(title) + "</strong>" + esc(desc) + "</div>" +
    table(["Метрика", "A · " + ab.control.trim(), "B · " + ab.treatment.trim(),"Δ B − A","95% ДИ"],rows,"Результаты A/B-теста"),
    '<button class="button" id="ab-export">Скачать расчёт</button>',"gap");
}

function render() {
  chartObserver?.disconnect();
  $("#crumb").textContent = pageNames[state.page];
  document.querySelectorAll("#nav button").forEach(b => {
    if (b.dataset.page === state.page) b.setAttribute("aria-current","page");
    else b.removeAttribute("aria-current");
  });
  if(state.page === "overview") {
    const {html,trend} = overview();
    main.innerHTML = html;
    const canvas = $("#trend");
    if (canvas) {
      draw(canvas,trend);
      chartObserver = new ResizeObserver(() => draw(canvas,trend));
      chartObserver.observe(canvas);
    }
  } else if (state.page === "dataset") {
    main.innerHTML = dataset(); drawRows();
  } else if (state.page === "explore") {
    main.innerHTML = explore(); drawGroups();
  } else {
    main.innerHTML = experiment(); drawExperiment();
  }
}

function download(name,text,mime="text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text],{type:mime}));
  const link = document.createElement("a");
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url),30000);
  toast("Файл подготовлен");
}

function doExport(id) {
  if (id === "rows-export") download("analitika-selection.csv",lab.exportCSV(state.data.headers,displayRows()));
  if (id === "profile-export") {
    const data = state.profile.columns.map(c => [c.name,types[c.type],c.distinct,c.blanks,c.blanks/state.data.rows.length,
      ...(c.type === "number" ? [c.min,c.max,c.mean] : ["","",""])]);
    download("analitika-profile.csv",lab.exportCSV(["Поле","Тип","Уникальных","Пустых","Доля пустых","Мин","Макс","Среднее"],data));
  }
  if (id === "groups-export") {
    const {dimensions,list} = getGroups();
    download("analitika-slice.csv",lab.exportCSV([...dimensions.map(i => state.data.headers[i]),"Строки",ops[state.slice.operation]],
      list.map(p => [...p.key,p.rows,p.value])));
  }
  if (id === "ab-export" && state.result) {
    download("analitika-experiment.json",JSON.stringify({
      dataset:state.data.name, settings:state.ab,
      units:{split:"percent",minGain:"percentage points",maxGuard:"percentage points",effects:"fraction"},
      decision:decisions[state.result.decision][0], result:state.result
    },null,2),"application/json");
  }
}

$("#nav").addEventListener("click",event => {
  const button = event.target.closest("[data-page]");
  if (button) goto(button.dataset.page);
});

main.addEventListener("click",event => {
  const b = event.target.closest("button");
  if (!b) return;
  if (b.dataset.goto) { goto(b.dataset.goto); return; }
  if (b.dataset.remove !== undefined || b.id === "clear-filters") {
    if (b.id === "clear-filters") state.filters = [];
    else state.filters.splice(Number(b.dataset.remove),1);
    state.rowPage = state.groupPage = 0; render(); return;
  }
  if (b.dataset.sort !== undefined) {
    const column = Number(b.dataset.sort);
    state.sort = {column,direction:state.sort?.column === column ? -state.sort.direction : 1};
    state.rowPage=0; drawRows();
    main.querySelector('[data-sort="' + column + '"]')?.focus();
  }
  if (b.dataset.rowPage) {state.rowPage += Number(b.dataset.rowPage); drawRows();}
  if (b.dataset.groupPage) {state.groupPage += Number(b.dataset.groupPage); drawGroups();}
  if (b.id.endsWith("-export")) doExport(b.id);
});

main.addEventListener("input",event => {
  if (event.target.id !== "row-query") return;
  state.query = event.target.value; state.rowPage=0; drawRows();
});

main.addEventListener("change",event => {
  const target = event.target;
  if (target.id === "filter-op") $("#filter-value").disabled = target.value === "blank";
  if (!target.dataset.slice) return;
  const key = target.dataset.slice;
  state.slice[key] = key === "operation" ? target.value : Number(target.value);
  if (key === "operation") $("[data-slice=measure]").disabled = target.value === "count";
  state.groupPage=0; drawGroups();
});

main.addEventListener("submit",event => {
  event.preventDefault();
  if (event.target.id === "filters") {
    const column = Number($("#filter-column").value), operator = $("#filter-op").value;
    const value = $("#filter-value").value.trim();
    if (operator !== "blank" && !value) return toast("Введите значение фильтра");
    if (["gte","lte"].includes(operator) && lab.numeric(value) === null) return toast("Для этого условия нужно число");
    state.filters.push({column,operator,value});
    state.rowPage = state.groupPage = 0; render();
  }
  if (event.target.id === "ab-form") {
    event.target.querySelectorAll("[data-ab]").forEach(field => {
      state.ab[field.dataset.ab] = field.type === "text" ? field.value : Number(field.value);
    });
    calculate(); drawExperiment();
  }
});

const dialog = $("#import-dialog");
function resetUpload() {
  importGeneration++;
  $("#import-form").reset(); draggedFile = undefined;
  $("#import-submit").disabled = false;
  $("#file-caption").textContent = "Выберите или перетащите файл";
  $("#import-error").hidden = true;
}
$("#upload").addEventListener("click",() => {resetUpload(); dialog.showModal();});
$("#close-dialog").addEventListener("click",() => dialog.close());
function openDemo() {switchData(lab.demo()); goto("overview"); toast("Демоданные открыты");}
$("#demo").addEventListener("click",openDemo);
$("#mobile-demo").addEventListener("click",openDemo);
$("#file").addEventListener("change",event => {
  draggedFile = undefined;
  $("#file-caption").textContent = event.target.files[0]?.name || "Выберите или перетащите файл";
});
const drop = $("#file-zone");
drop.addEventListener("dragover",event => {event.preventDefault();drop.classList.add("drag");});
drop.addEventListener("dragleave",() => drop.classList.remove("drag"));
drop.addEventListener("drop",event => {
  event.preventDefault(); drop.classList.remove("drag");
  draggedFile = event.dataTransfer.files[0];
  if (draggedFile) $("#file-caption").textContent = draggedFile.name;
});
$("#import-form").addEventListener("submit",async event => {
  event.preventDefault();
  const submit = $("#import-submit"), error = $("#import-error");
  const generation = importGeneration, encoding = $("#encoding").value, separator = $("#separator").value;
  submit.disabled = true; error.hidden = true;
  try {
    const file = draggedFile || $("#file").files[0];
    if (!file) throw new Error("Выберите CSV или TSV.");
    if (file.size > 20*1024*1024) throw new Error("Файл больше 20 МБ.");
    const bytes = await file.arrayBuffer();
    if (!dialog.open || importGeneration !== generation) return;
    let content;
    try { content = new TextDecoder(encoding,{fatal:true}).decode(bytes); }
    catch { throw new Error("Кодировка не совпала. Попробуйте Windows-1251 или пересохраните файл в UTF-8."); }
    const data = lab.parseCSV(content,separator);
    switchData({...data,name:file.name,demo:false}); dialog.close(); goto("overview");
    toast("Таблица загружена");
  } catch (e) {
    if (importGeneration === generation) {error.textContent=e.message; error.hidden = false;}
  } finally { if (importGeneration === generation) submit.disabled=false; }
});

switchData(lab.demo());
render();
