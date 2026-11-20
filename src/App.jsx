import { useEffect, useState, useCallback } from "react";
import "./App.css";

// Change this, or set VITE_API_URL in a .env file, to wherever your Express API runs.
const API = import.meta.env.VITE_API_URL || "http://localhost:3000";

async function req(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = j.message || j.error || JSON.stringify(j);
    } catch {}
    throw new Error(`${res.status} ${msg}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Accepts a bare array or an object wrapping one ({ questions: [...] }, { data: [...] }).
const asList = (d, key) => (Array.isArray(d) ? d : d?.[key] ?? d?.data ?? []);

const msToDate = (ms) => (ms ? new Date(Number(ms)).toISOString().slice(0, 10) : "");
const dateToMs = (s) => (s ? new Date(s).getTime() : null);

const LOGIC_OPTIONS = ["Pairs", "Sequence", "Quartet", "Odd-One-Out"];
const TARGET_OPTIONS = ["8", "12", "16", "20", "24", "Unlimited"]; // dropdown labels
const DEFAULT_MAX = 8;
// maxQuestions is a number, or null meaning "Unlimited".
const maxToLabel = (m) => (m === null ? "Unlimited" : String(m ?? DEFAULT_MAX));
const labelToMax = (l) => (l === "Unlimited" ? null : Number(l));

const EMPTY_SET = { title: "", description: "", logic: "", maxQuestions: DEFAULT_MAX, published: false, publicationDate: null };
const EMPTY_Q = { question: "", answer: "", questionCategory: "", questionFormat: "" };

// Where a set stands against its target. "Unlimited" sets have no cap and are never "complete".
function progress(maxQuestions, count) {
  if (maxQuestions === null) return { cap: null, state: "open", text: `${count} question${count === 1 ? "" : "s"}` };
  const cap = Number(maxQuestions ?? DEFAULT_MAX);
  const state = count === cap ? "complete" : count > cap ? "over" : "under";
  return { cap, state, text: `${count} of ${cap}` };
}

export default function App() {
  const [sets, setSets] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [selected, setSelected] = useState(null); // set id, "new", or null
  const [detail, setDetail] = useState(null); // the selected set as fetched by GET /questionSets/:id
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (fn) => {
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError(e.message === "Failed to fetch" ? `Can't reach the API at ${API}. Is it running, and is CORS enabled?` : e.message);
    } finally {
      setBusy(false);
    }
  }, []);

  const load = useCallback(
    () =>
      run(async () => {
        const [s, q] = await Promise.all([req("GET", "/questionSets"), req("GET", "/questions")]);
        setSets(asList(s, "questionSets"));
        setQuestions(asList(q, "questions"));
      }),
    [run]
  );

  useEffect(() => {
    load();
  }, [load]);

  const fetchDetail = useCallback(async (id) => {
    const d = await req("GET", `/questionSet/${id}`);
    setDetail(d?.questionSet ?? d);
  }, []);

  useEffect(() => {
    if (selected && selected !== "new") run(() => fetchDetail(selected));
    else setDetail(null);
  }, [selected, run, fetchDetail]);

  // Use the freshly fetched set once it arrives; the list copy fills in while it loads.
  const fresh = detail?.id === selected;
  const current = fresh ? detail : sets.find((s) => s.id === selected);
  const setQuestionsForCurrent = questions.filter((q) => q.questionSetId === selected);

  return (
    <div className="shell">
      <aside className="side">
        <h1>Quiz admin</h1>
        <button className="primary wide" onClick={() => setSelected("new")}>
          New question set
        </button>
        <ul className="set-list">
          {sets.map((s) => {
            const p = progress(s.maxQuestions, questions.filter((q) => q.questionSetId === s.id).length);
            return (
              <li key={s.id}>
                <button className={s.id === selected ? "set active" : "set"} onClick={() => setSelected(s.id)}>
                  <span className="set-title">{s.title || "Untitled set"}</span>
                  <small>
                    <span>{p.text}</span>
                    {p.state === "complete" && <span className="badge ok">Complete</span>}
                    {p.state === "over" && <span className="badge warn-badge">Over target</span>}
                    {!s.published && <span className="badge">Draft</span>}
                  </small>
                </button>
              </li>
            );
          })}
          {sets.length === 0 && <li className="empty">No question sets yet.</li>}
        </ul>
      </aside>

      <main className="main">
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="Dismiss">×</button>
          </div>
        )}
        {busy && <div className="busy">Working…</div>}

        {selected === null && <p className="empty">Choose a question set, or create a new one.</p>}

        {selected === "new" && (
          <SetForm
            key="new"
            initial={EMPTY_SET}
            allSets={sets}
            onSave={(data) =>
              run(async () => {
                const created = await req("POST", "/questionSet", data);
                await load();
                setSelected(created?.id ?? created?.questionSet?.id ?? null);
              })
            }
            onCancel={() => setSelected(null)}
          />
        )}

        {current && (
          <>
            <SetForm
              key={`${current.id}-${fresh ? "fresh" : "list"}`}
              initial={current}
              allSets={sets}
              questionCount={setQuestionsForCurrent.length}
              onSave={(data) =>
                run(async () => {
                  await req("PUT", `/questionSet/${current.id}`, data);
                  await load();
                  await fetchDetail(current.id);
                })
              }
              onDelete={() => {
                if (!window.confirm(`Delete "${current.title}"? This cannot be undone.`)) return;
                run(async () => {
                  await req("DELETE", `/questionSet/${current.id}`);
                  setSelected(null);
                  await load();
                });
              }}
            />
            <Questions
              setId={current.id}
              maxQuestions={current.maxQuestions}
              items={setQuestionsForCurrent}
              run={run}
              reload={load}
            />
          </>
        )}
      </main>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Select({ value, options, onChange, placeholder, required }) {
  // Keep a stored value that is no longer in the list visible, so saving never silently changes it.
  const opts = value && !options.includes(value) ? [...options, value] : options;
  return (
    <select required={required} value={value ?? ""} onChange={onChange}>
      {placeholder && <option value="">{placeholder}</option>}
      {opts.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

function SetForm({ initial, allSets, questionCount = 0, onSave, onDelete, onCancel }) {
  const [f, setF] = useState({ ...EMPTY_SET, ...initial });
  const isNew = !initial.id;

  // Non-blocking warnings, since the app will pick a quiz by today's date.
  const day = msToDate(f.publicationDate);
  const clash = day ? allSets.filter((s) => s.id !== initial.id && msToDate(s.publicationDate) === day) : [];
  const warnings = [];
  if (clash.length > 0) {
    warnings.push(`${clash.map((s) => `"${s.title || "Untitled set"}"`).join(", ")} already uses ${day}. Only one quiz can be picked for a date.`);
  }
  if (f.published && !day && f.maxQuestions !== null) {
    warnings.push("This set is published but has no publication date, so it won't be picked for any day.");
  }
  const prog = progress(f.maxQuestions, questionCount);
  if (prog.state === "over") {
    warnings.push(`This set has ${questionCount} questions, over its target of ${prog.cap}. No more can be added until some are removed or the target is raised.`);
  }
  const up = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const submit = (e) => {
    e.preventDefault();
    onSave({
      title: f.title,
      description: f.description,
      logic: f.logic,
      maxQuestions: f.maxQuestions,
      published: !!f.published,
      publicationDate: f.publicationDate,
    });
  };

  return (
    <form className="panel" onSubmit={submit}>
      <h2>{isNew ? "New question set" : "Question set"}</h2>
      <Field label="Title">
        <input required maxLength={255} value={f.title ?? ""} onChange={up("title")} />
      </Field>
      <Field label="Description (up to 700 characters)">
        <textarea rows={3} maxLength={700} value={f.description ?? ""} onChange={up("description")} />
      </Field>
      <div className="row">
        <Field label="Logic">
          <Select required value={f.logic} options={LOGIC_OPTIONS} placeholder="Select logic…" onChange={up("logic")} />
        </Field>
        <Field label="Target size">
          <Select
            value={maxToLabel(f.maxQuestions)}
            options={TARGET_OPTIONS}
            onChange={(e) => setF({ ...f, maxQuestions: labelToMax(e.target.value) })}
          />
        </Field>
        <Field label="Publication date">
          <input
            type="date"
            value={msToDate(f.publicationDate)}
            onChange={(e) => setF({ ...f, publicationDate: dateToMs(e.target.value) })}
          />
        </Field>
        <label className="check">
          <input type="checkbox" checked={!!f.published} onChange={up("published")} />
          Published
        </label>
      </div>
      {warnings.map((w) => (
        <p className="warn" key={w} role="status">{w}</p>
      ))}
      <div className="actions">
        <button className="primary" type="submit">{isNew ? "Create set" : "Save changes"}</button>
        {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
        {onDelete && (
          <button type="button" className="danger" onClick={onDelete}>
            Delete set
          </button>
        )}
      </div>
    </form>
  );
}

function Questions({ setId, maxQuestions, items, run, reload }) {
  const [editing, setEditing] = useState(null); // question object, "new", or null
  const p = progress(maxQuestions, items.length);
  const full = p.cap !== null && items.length >= p.cap;

  const startEdit = (q) =>
    // GET /question/:id so the form always starts from the saved version
    run(async () => setEditing(await req("GET", `/question/${q.id}`)));

  const save = (data) =>
    run(async () => {
      if (editing === "new" && full) return; // never go past the target
      if (editing === "new") await req("POST", "/question", { ...data, questionSetId: setId });
      else await req("PUT", `/question/${editing.id}`, { ...data, questionSetId: setId });
      setEditing(null);
      await reload();
    });

  const remove = (q) => {
    if (!window.confirm("Delete this question?")) return;
    run(async () => {
      await req("DELETE", `/question/${q.id}`);
      await reload();
    });
  };

  return (
    <section className="panel">
      <div className="head">
        <h2>
          Questions <span className={`count-pill ${p.state}`}>{p.text}</span>
        </h2>
        <button className="primary" disabled={full} onClick={() => setEditing("new")}>Add question</button>
      </div>
      {p.state === "complete" && <p className="note ok">This set is complete. Delete a question to add another, or raise the target size.</p>}
      {p.state === "over" && <p className="note over">This set is over its target of {p.cap}. Remove {items.length - p.cap} or raise the target size.</p>}
      {p.state === "under" && items.length > 0 && <p className="note">{p.cap - items.length} more needed to complete this set.</p>}

      {editing && (
        <QuestionForm
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? EMPTY_Q : editing}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}

      {items.length === 0 ? (
        <p className="empty">This set has no questions yet.</p>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Pair</th>
                <th>Question</th>
                <th>Answer</th>
                <th>Category</th>
                <th>Format</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((q) => (
                <tr key={q.id}>
                  <td>{q.pairId}</td>
                  <td>{q.question}</td>
                  <td>{q.answer}</td>
                  <td>{q.questionCategory}</td>
                  <td>{q.questionFormat}</td>
                  <td className="nowrap">
                    <button onClick={() => startEdit(q)}>Edit</button>{" "}
                    <button className="danger" onClick={() => remove(q)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function QuestionForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState({ ...EMPTY_Q, ...initial });
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = (e) => {
    e.preventDefault();
    onSave({
      question: f.question,
      answer: f.answer,
      questionCategory: f.questionCategory,
      questionFormat: f.questionFormat,
    });
  };
  return (
    <form className="subform" onSubmit={submit}>
      <Field label="Question">
        <input required maxLength={255} value={f.question} onChange={up("question")} />
      </Field>
      <Field label="Answer">
        <input required maxLength={255} value={f.answer} onChange={up("answer")} />
      </Field>
      <div className="row">
        <Field label="Category">
          <input required maxLength={255} value={f.questionCategory} onChange={up("questionCategory")} />
        </Field>
        <Field label="Format">
          <input required maxLength={255} value={f.questionFormat} onChange={up("questionFormat")} />
        </Field>
      </div>
      <div className="actions">
        <button className="primary" type="submit">{initial.id ? "Save question" : "Add question"}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
