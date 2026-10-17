import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
function ui() {
  const elements = new Map<string, any>();
  const make = () => ({
    value: "",
    textContent: "",
    className: "",
    disabled: false,
    hidden: false,
    children: [] as any[],
    setAttribute() {},
    append(...x: any[]) {
      this.children.push(...x);
    },
    replaceChildren() {
      this.children = [];
    },
    showModal() {},
    close() {},
  });
  const get = (id: string) => {
    if (!elements.has(id)) elements.set(id, make());
    return elements.get(id);
  };
  const context = vm.createContext({
    document: {
      getElementById: get,
      createElement: make,
      querySelectorAll: () => [...elements.values(), ...get("list").children],
    },
    crypto: { randomUUID },
    setInterval() {},
    setTimeout,
    clearTimeout,
    addEventListener() {},
    location: { hash: "#fixture" },
    parent: {},
  });
  const script = readFileSync(
    new URL("../ui/notes.html", import.meta.url),
    "utf8",
  )
    .split("<script>")[1]
    .split("</script>")[0];
  vm.runInContext(script, context);
  return { context, get, run: (s: string) => vm.runInContext(s, context) };
}
const note = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "old",
  body: "old body",
  reminderAt: null,
  updatedAt: new Date().toISOString(),
};
test("clean form and revision refresh together, including remote deletion", async () => {
  const x = ui();
  x.run(
    `notes=[${JSON.stringify(note)}];revision='1';select(notes[0]);action=async()=>({notes:[{...notes[0],title:'remote'}],revision:'2'});`,
  );
  await x.run("refresh()");
  assert.equal(x.get("title").value, "remote");
  assert.equal(x.run("revision"), "2");
  x.run("action=async()=>({notes:[],revision:'3'})");
  await x.run("refresh()");
  assert.equal(x.get("title").value, "");
  assert.equal(x.get("delete").hidden, true);
});
test("in-flight refresh cannot overwrite a new draft or advance its revision", async () => {
  const x = ui();
  x.run(
    `notes=[${JSON.stringify(note)}];revision='1';select(notes[0]);action=()=>new Promise(r=>globalThis.finish=r);globalThis.pendingRefresh=refresh();`,
  );
  x.get("title").value = "typing";
  x.run("finish({notes:[{...notes[0],title:'remote'}],revision:'2'})");
  await x.run("pendingRefresh");
  assert.equal(x.get("title").value, "typing");
  assert.equal(x.run("revision"), "1");
});
test("mutation freezes editor and selection until response", () => {
  const x = ui();
  x.run(`notes=[${JSON.stringify(note)}];select(notes[0]);setBusy(true)`);
  for (const id of ["title", "body", "reminder", "new"])
    assert.equal(x.get(id).disabled, true);
  assert.equal(x.get("list").children[0].disabled, true);
  x.run("setBusy(false)");
  assert.equal(x.get("title").disabled, false);
});
