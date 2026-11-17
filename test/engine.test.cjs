const assert = require("node:assert/strict");
const test = require("node:test");
require("../dist/engine.js");
const lab = globalThis.Lab;

test("CSV import recognizes separator, BOM, multiline fields and escaped quotes", () => {
  const input = '\uFEFFid;name;amount\r\n001;"line 1\r\nline ""2""";"2,50"\r\n002;x;\r\n';
  const data = lab.parseCSV(input);
  assert.equal(data.delimiter, ";");
  assert.deepEqual(data.headers, ["id","name","amount"]);
  assert.deepEqual(data.rows, [["001",'line 1\r\nline "2"',"2,50"],["002","x",""]]);
  assert.equal(lab.numeric(data.rows[0][0]),null);
  assert.equal(lab.numeric(data.rows[0][2]),2.5);
});

test("TSV preserves trailing empty fields with and without final newline", () => {
  for (const input of ["id\tcity\n1\t","id\tcity\n1\t\n"]) {
    assert.deepEqual(lab.parseCSV(input).rows,[["1",""]]);
  }
});

test("CSV rejects malformed rows, broken quoting and ambiguous headers", () => {
  assert.throws(() => lab.parseCSV("a,a\n1,2"),/уникальны/);
  assert.throws(() => lab.parseCSV('a,b\n1,"broken'),/незакрытое/);
  assert.throws(() => lab.parseCSV("a,b\n1,2,3"),/отличается/);
  assert.throws(() => lab.parseCSV("a,b\n"),/хотя бы одну/);
});

test("profile counts duplicates and missing cells without treating zero as missing", () => {
  const data = lab.parseCSV("id;date;amount\n001;2026-10-01;0\n001;2026-10-01;0\n002;2026-10-02;");
  const p = lab.profile(data.headers,data.rows);
  assert.deepEqual(p.columns.map(c => c.type),["text","date","number"]);
  assert.equal(p.duplicates,1);
  assert.equal(p.missing,1);
  assert.equal(p.complete,2);
  assert.equal(lab.dateKey("2026-02-31"),null);
});

test("multifield filters and aggregation preserve signed numeric values", () => {
  const rows = [["App","Moscow","4"],["App","Moscow","-1"],["App","Kazan",""],["Web","Moscow","99"]];
  const chosen = lab.filterRows(rows,[{column:0,operator:"equals",value:"App"}]);
  const groups = lab.aggregate(chosen,[0,1],2,"average");
  assert.deepEqual(groups, [{key:["App","Moscow"],rows:2,value:1.5},{key:["App","Kazan"],rows:1,value:null}]);
  assert.equal(lab.filterRows(chosen,[{column:2,operator:"gte",value:"0"}]).length,1);
});

test("A/B uses independent binary observations, counts exclusions and checks SRM", () => {
  const options = {id:0,variant:1,outcome:2,guard:3,control:"A",treatment:"B",split:.5,minGain:.005,maxGuard:.004};
  function rows(nA,nB) {
    return [...Array.from({length:nA},(_,i) => ["a"+i,"A",String(Number(i < nA*.3)),"0"]),
            ...Array.from({length:nB},(_,i) => ["b"+i,"B",String(Number(i < nB*.4)),String(Number(i < nB*.02))])];
  }
  const equal = rows(1000,1000);
  const result = lab.runExperiment([...equal,["x","C","0","0"]],options);
  assert.equal(result.srm,1);
  assert.equal(result.excluded,1);
  assert.ok(Math.abs(result.primary.diff-.1)<1e-12);
  assert.ok(result.primary.low>.05 && result.primary.high<.15);
  assert.equal(result.decision,"guard");
  assert.equal(lab.runExperiment(rows(1000,400),options).decision,"srm");
  assert.throws(() => lab.runExperiment([...equal,equal[0]],options),/уникальны/);
  assert.throws(() => lab.runExperiment([["bad","A","yes","0"],...equal],options),/ровно 0 или 1/);
});

test("CSV exports neutralize spreadsheet formulas and retain negative numbers", () => {
  const out = lab.exportCSV(["a","b","c"],[["=SUM(1)","-5",'"sample"']]);
  assert.deepEqual(lab.parseCSV(out).rows,[["'=SUM(1)","-5",'"sample"']]);
});

test("synthetic demo produces the clean-room metrics expected by the UI", () => {
  const data = lab.demo();
  assert.equal(data.rows.length,4800);
  assert.equal(lab.profile(data.headers,data.rows).missing,133);
  const result = lab.runExperiment(data.rows,{id:0,variant:5,outcome:6,guard:7,control:"A",treatment:"B",
    split:.5,minGain:.005,maxGuard:.004});
  assert.equal(result.a.n+result.b.n,4800);
  assert.equal(result.decision,"guard");
});
