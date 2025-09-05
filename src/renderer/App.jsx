import { useMemo, useState, useRef, useCallback, useEffect } from 'react';

function extractDraftOps(jsonOrFenced) {
  try {
    const m = /```json\s*([\s\S]*?)\s*```/i.exec(jsonOrFenced || '');
    const raw = m ? m[1] : jsonOrFenced;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    if (!Array.isArray(obj.operations)) obj.operations = [];
    console.log("extractDraftOps:obj is ok >>>", obj)
    return obj;
  } catch (_) {
    console.log("extractDraftOps:obj is not ok >>>", _)
    return null;
  }
}

function applyDraftOps(draft, ops) {
  let text = draft || '';
  for (const op of ops || []) {
    try {
      if (op.op === 'replace_all' && typeof op.text === 'string') {
        text = op.text;
      } else if (op.op === 'append_section' && op.heading && typeof op.text === 'string') {
        const section = `\n\n## ${op.heading}\n\n${op.text}`;
        text = (text || '') + section;
      } else if (op.op === 'patch' && typeof op.find === 'string' && typeof op.replace === 'string') {
        const count = Math.max(1, Number(op.count) || 1);
        let remaining = count;
        let idx;
        while (remaining > 0 && (idx = text.indexOf(op.find)) !== -1) {
          text = text.slice(0, idx) + op.replace + text.slice(idx + op.find.length);
          remaining--;
        }
      } else if (op.op === 'set_title' && typeof op.text === 'string') {
        const lines = (text || '').split(/\r?\n/);
        if (lines[0] && /^\s*#\s+/.test(lines[0])) {
          lines[0] = `# ${op.text}`;
          text = lines.join('\n');
        } else {
          text = `# ${op.text}\n\n` + (text || '');
        }
      } else if (op.op === 'replace_range') {
        const start = Math.max(0, Number(op.start) || 0);
        const end = Math.max(start, Number(op.end) || start);
        const t = String(op.text || '');
        if (end > start && start <= text.length) {
          const clampedEnd = Math.min(end, text.length);
          text = text.slice(0, start) + t + text.slice(clampedEnd);
        }
      }
    } catch (_) {
      // ignore faulty op
    }
  }
  return text;
}

// --- Line diff utilities (LCS) ---
function diffLines(aText, bText) {
  const a = (aText || '').split(/\r?\n/);
  const b = (bText || '').split(/\r?\n/);
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const hunks = [];
  let i = 0, j = 0;
  const push = (type, line) => {
    const last = hunks[hunks.length - 1];
    if (last && last.type === type) last.lines.push(line); else hunks.push({ type, lines: [line] });
  };
  while (i < m && j < n) {
    if (a[i] === b[j]) { push('equal', a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', a[i]); i++; }
    else { push('add', b[j]); j++; }
  }
  while (i < m) { push('del', a[i]); i++; }
  while (j < n) { push('add', b[j]); j++; }
  return hunks;
}

function DiffView({ before, after }) {
  const hunks = diffLines(before, after);
  const lineStyle = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, whiteSpace: 'pre-wrap', padding: '2px 6px', borderRadius: 6 };
  const rowStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' };
  const gutter = (symbol, color) => <span style={{ display: 'inline-block', width: 18, color, opacity: 0.9 }}>{symbol}</span>;
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {hunks.map((h, idx) => {
        if (h.type === 'equal') {
          return h.lines.map((ln, k) => (
            <div key={idx + '-' + k} style={rowStyle}>
              <div style={lineStyle}>{gutter(' ', '#999')}{ln}</div>
              <div style={lineStyle}>{gutter(' ', '#999')}{ln}</div>
            </div>
          ));
        } else if (h.type === 'del') {
          return h.lines.map((ln, k) => (
            <div key={idx + '-' + k} style={rowStyle}>
              <div style={{ ...lineStyle, background: '#ffebe9', border: '1px solid #ffb3ad' }}>{gutter('-', '#c33')}{ln}</div>
              <div />
            </div>
          ));
        } else { // add
          return h.lines.map((ln, k) => (
            <div key={idx + '-' + k} style={rowStyle}>
              <div />
              <div style={{ ...lineStyle, background: '#e6ffed', border: '1px solid #b4f0c2' }}>{gutter('+', '#2a7')}{ln}</div>
            </div>
          ));
        }
      })}
    </div>
  );
}

// 带控制箭头的双栏 Diff（基于基线 before vs proposed）
function DiffViewWithControls({ before, proposed, selections, onToggle }) {
  const hunks = useMemo(() => diffLines(before, proposed), [before, proposed]);
  const lineStyle = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, whiteSpace: 'pre-wrap', padding: '2px 6px', borderRadius: 6 };
  const rowStyle = { display: 'grid', gridTemplateColumns: '1fr 34px 1fr', gap: 8, alignItems: 'start' }; 
  const leftCell = (el) => <div style={lineStyle}>{el}</div>;
  const rightCell = (el) => <div style={lineStyle}>{el}</div>;
  const badge = (symbol, color) => <span style={{ display: 'inline-block', width: 18, color, opacity: 0.9 }}>{symbol}</span>;
  const btnStyle = (active) => ({
    width: 26, height: 20, borderRadius: 4, border: '1px solid #8884', cursor: 'pointer', fontSize: 12,
    background: active ? '#e9f2ff' : '#f8f8f8', color: active ? '#2563eb' : '#333'
  });

  const rows = [];
  let blockIdx = 0;
  for (let i = 0; i < hunks.length; i++) {
    const h = hunks[i];
    if (h.type === 'equal') {
      h.lines.forEach((ln, k) => {
        rows.push(
          <div key={`eq-${i}-${k}`} style={rowStyle}>
            {leftCell(<>{badge(' ', '#999')}{ln}</>)}
            <div />
            {rightCell(<>{badge(' ', '#999')}{ln}</>)}
          </div>
        );
      });
      continue;
    }

    const next = hunks[i + 1];
    if (h.type === 'del' && next?.type === 'add') {
      const maxLen = Math.max(h.lines.length, next.lines.length);
      for (let k = 0; k < maxLen; k++) {
        const a = h.lines[k];
        const b = next.lines[k];
        const accepted = !!selections[blockIdx];
        rows.push(
          <div key={`pair-${i}-${k}`} style={rowStyle}>
            {leftCell(a != null ? <>{badge('-', '#c33')}{a}</> : <></>)}
            {k === 0 ? (
              <div style={{ display: 'grid', gap: 4, alignContent: 'start', justifyItems: 'center' }}>
                <button title="保留原文" style={btnStyle(!selections[blockIdx])} onClick={() => onToggle(blockIdx, false)}>←</button>
                <button title="采用修改" style={btnStyle(!!selections[blockIdx])} onClick={() => onToggle(blockIdx, true)}>→</button>
              </div>
            ) : <div />}
            {rightCell(
              accepted
                ? (b != null ? <>{badge('+', '#2a7')}{b}</> : <></>)
                : (a != null ? <>{badge(' ', '#999')}{a}</> : <></>)
            )}
          </div>
        );
      }
      i++; // consume add
      blockIdx++;
    } else if (h.type === 'del') {
      h.lines.forEach((ln, k) => {
        const accepted = !!selections[blockIdx];
        rows.push(
          <div key={`del-${i}-${k}`} style={rowStyle}>
            {leftCell(<>{badge('-', '#c33')}{ln}</>)}
            {k === 0 ? (
              <div style={{ display: 'grid', gap: 4, alignContent: 'start', justifyItems: 'center' }}>
                <button title="保留原文" style={btnStyle(!selections[blockIdx])} onClick={() => onToggle(blockIdx, false)}>←</button>
                <button title="采用修改(删除)" style={btnStyle(!!selections[blockIdx])} onClick={() => onToggle(blockIdx, true)}>→</button>
              </div>
            ) : <div />}
            {rightCell(accepted ? <></> : <>{badge(' ', '#999')}{ln}</>)}
          </div>
        );
      });
      blockIdx++;
    } else if (h.type === 'add') {
      h.lines.forEach((ln, k) => {
        const accepted = !!selections[blockIdx];
        rows.push(
          <div key={`add-${i}-${k}`} style={rowStyle}>
            <div />
            {k === 0 ? (
              <div style={{ display: 'grid', gap: 4, alignContent: 'start', justifyItems: 'center' }}>
                <button title="不新增" style={btnStyle(!selections[blockIdx])} onClick={() => onToggle(blockIdx, false)}>←</button>
                <button title="新增此行" style={btnStyle(!!selections[blockIdx])} onClick={() => onToggle(blockIdx, true)}>→</button>
              </div>
            ) : <div />}
            {rightCell(accepted ? <>{badge('+', '#2a7')}{ln}</> : <></>)}
          </div>
        );
      });
      blockIdx++;
    }
  }
  return <div style={{ display: 'grid', gap: 4 }}>{rows}</div>;
}

// Character-level diff for inline highlighting
function diffChars(aText, bText) {
  const a = Array.from(aText || '');
  const b = Array.from(bText || '');
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const segs = [];
  let i = 0, j = 0;
  const push = (type, ch) => {
    const last = segs[segs.length - 1];
    if (last && last.type === type) last.text += ch; else segs.push({ type, text: ch });
  };
  while (i < m && j < n) {
    if (a[i] === b[j]) { push('equal', a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', a[i]); i++; }
    else { push('add', b[j]); j++; }
  }
  while (i < m) { push('del', a[i]); i++; }
  while (j < n) { push('add', b[j]); j++; }
  return segs;
}

function InlineDiffView({ before, after }) {
  const hunks = diffLines(before, after);
  const lineStyle = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, whiteSpace: 'pre-wrap', padding: '2px 6px', borderRadius: 6 };
  const row = (content, bg, border, symbol, color) => (
    <div style={{ ...lineStyle, background: bg, border: border ? `1px solid ${border}` : 'none' }}>
      <span style={{ display: 'inline-block', width: 18, color, opacity: 0.9 }}>{symbol}</span>
      {content}
    </div>
  );

  const renderSegments = (segs, focus) => (
    <>
      {segs.map((s, i) => {
        if (s.type === 'equal') return <span key={i}>{s.text}</span>;
        if (s.type === 'add' && focus === 'add') return <span key={i} style={{ background: '#e6ffed' }}>{s.text}</span>;
        if (s.type === 'del' && focus === 'del') return <span key={i} style={{ background: '#ffebe9' }}>{s.text}</span>;
        return <span key={i}>{s.text}</span>;
      })}
    </>
  );

  const out = [];
  for (let idx = 0; idx < hunks.length; idx++) {
    const h = hunks[idx];
    if (h.type === 'equal') {
      h.lines.forEach((ln, k) => {
        out.push(<div key={`e-${idx}-${k}`} style={lineStyle}><span style={{ display: 'inline-block', width: 18, color: '#999' }}> </span>{ln}</div>);
      });
    } else if (h.type === 'del') {
      const next = hunks[idx + 1];
      if (next && next.type === 'add') {
        const maxLen = Math.max(h.lines.length, next.lines.length);
        for (let i = 0; i < maxLen; i++) {
          const a = h.lines[i];
          const b = next.lines[i];
          if (a != null && b != null) {
            const segs = diffChars(a, b);
            out.push(row(renderSegments(segs, 'del'), '#ffebe9', '#ffb3ad', '-', '#c33'));
            out.push(row(renderSegments(segs, 'add'), '#e6ffed', '#b4f0c2', '+', '#2a7'));
          } else if (a != null) {
            out.push(row(a, '#ffebe9', '#ffb3ad', '-', '#c33'));
          } else if (b != null) {
            out.push(row(b, '#e6ffed', '#b4f0c2', '+', '#2a7'));
          }
        }
        idx++; // consume paired add hunk
      } else {
        h.lines.forEach((ln, k) => {
          out.push(row(ln, '#ffebe9', '#ffb3ad', '-', '#c33'));
        });
      }
    } else if (h.type === 'add') {
      h.lines.forEach((ln, k) => {
        out.push(row(ln, '#e6ffed', '#b4f0c2', '+', '#2a7'));
      });
    }
  }
  return <div style={{ display: 'grid', gap: 4 }}>{out}</div>;
}

export default function App() {
  const [files, setFiles] = useState([]); // [{path,name,title,notes}]

  if (!files?.length) {
    return <SelectPDFs onSelected={setFiles} />;
  }

  return <MainWork files={files} onAdd={async (more) => setFiles(prev => mergeFiles(prev, more))} />;
}

function mergeFiles(prev, more) {
  const map = new Map(prev.map(f => [f.path, f]));
  for (const m of more || []) {
    if (map.has(m.path)) {
      const exist = map.get(m.path);
      // 合并笔记（去重：按 page+subtype+contents+text 粗略）
      const key = (n) => `${n.page}|${n.subtype}|${n.contents || ''}|${n.text || ''}`;
      const seen = new Set((exist.notes || []).map(key));
      const mergedNotes = [...(exist.notes || [])];
      for (const n of (m.notes || [])) {
        const k = key(n);
        if (!seen.has(k)) { seen.add(k); mergedNotes.push(n); }
      }
      map.set(m.path, { ...exist, title: exist.title || m.title, notes: mergedNotes });
    } else {
      map.set(m.path, m);
    }
  }
  return Array.from(map.values());
}

function SelectPDFs({ onSelected }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const pick = async () => {
    setErr('');
    setBusy(true);
    try {
      if (!window.api || typeof window.api.openPDFs !== 'function') {
        throw new Error('预加载脚本未生效或 API 不可用：window.api.openPDFs 缺失');
      }
      const paths = await window.api.openPDFs();
      if (!paths || !paths.length) return;
      if (typeof window.api.extractHighlights !== 'function') {
        throw new Error('解析 API 不可用：window.api.extractHighlights 缺失');
      }
      const res = await window.api.extractHighlights(paths);
      if (res?.ok && res.data?.length) onSelected(res.data);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.screen}>
      <div style={styles.card}>
        <h1 style={{ margin: 0 }}>VibeWriting</h1>
        <p style={{ marginTop: 8, opacity: 0.8 }}>请选择一个或多个 PDF 文件开始。</p>
        <button onClick={pick} disabled={busy} style={styles.primaryBtn}>
          {busy ? '打开对话框…' : '选择 PDF 文件'}
        </button>
        {err && <div style={styles.error}>错误：{err}</div>}
        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
          支持多选；可稍后在左侧列表继续添加。
        </div>
      </div>
    </div>
  );
}

function MainWork({ files, onAdd }) {
  /*设置变量*/
  const [activeFiles, setActiveFiles] = useState(new Set([files[0]?.path].filter(Boolean)));
  const [drafts, setDrafts] = useState([{ id: 1, title: '草稿1', content: '' }]);
  const [activeDraftId, setActiveDraftId] = useState(1);
  const [nextDraftId, setNextDraftId] = useState(2);
  const [editingTabId, setEditingTabId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [chat, setChat] = useState([]); // {role:'user'|'assistant', content}
  const [chatActive, setChatActive] = useState(true); // Controls chat input availability
  const [panels, setPanels] = useState([25, 50, 25]); // Percentages for left, center, right
  const containerRef = useRef(null);
  const isDraggingRef = useRef(null); // 'left' | 'right' | null

  const activeFileObjs = useMemo(() => files.filter(f => activeFiles.has(f.path)), [files, activeFiles]);
  const activeGroups = useMemo(() => {
    const allGroups = [];
    activeFileObjs.forEach(fileObj => {
      if (fileObj.groups) {
        fileObj.groups.forEach(group => {
          allGroups.push({
            ...group,
            fileName: fileObj.name,
            fileTitle: fileObj.title
          });
        });
      }
    });
    return allGroups;
  }, [activeFileObjs]);

  const sendMsg = async (msg) => {
    if (!msg.trim() || !chatActive) return;
    
    // Disable chat input during API call
    setChatActive(false);
    
    // Add user message
    setChat(c => [...c, { role: 'user', content: msg }]);
    
    try {
      // Prepare context from active highlights
      const context = activeGroups.map(g => 
        `文件: ${g.fileName} (第${g.page}页)\n内容: ${g.contents?.join(' / ') || ''}\n文本: ${g.text || ''}`
      ).join('\n\n');
      
      // 将上下文并入用户消息，由主进程加载 SystemPrompt 作为 system
      const userWithCtx = `${msg}\n\n[上下文]\n${context}`;
      
      // Get current chat history for context
      const messages = chat.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      }));
      messages.push({ role: 'user', content: userWithCtx });
      
      const result = await window.api.aiChat(messages, null);
      
      if (result?.ok) {
        const content = result.data.content || '';
        setChat(c => [...c, { role: 'assistant', content }]);

        const ops = extractDraftOps(content);
        if (ops && Array.isArray(ops.operations)) {
          const proposed = applyDraftOps(activeDraft?.content || '', ops.operations);
          setPendingOps({ ops, proposedText: proposed, notes: ops.notes || '' });
          setShowPreview(true);
          setChat(c => [...c, { role: 'assistant', content: '已生成修改方案，已打开预览面板，请确认后应用。' }]);
        }
      } else {
        setChat(c => [...c, { role: 'assistant', content: `错误: ${result?.error || '未知错误'}` }]);
      }
    } catch (error) {
      setChat(c => [...c, { role: 'assistant', content: `错误: ${error.message || '网络或API错误'}` }]);
    } finally {
      // Re-enable chat input after API call completes
      setChatActive(true);
    }
  };

  const handleMouseMove = useCallback((e) => {
    if (isDraggingRef.current === null) return;

    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const totalWidth = rect.width;

    setPanels(currentPanels => {
      const newPanels = [...currentPanels];
      if (isDraggingRef.current === 'left') {
        const leftWidth = (x / totalWidth) * 100;
        const rightWidth = newPanels[2];
        const centerWidth = 100 - leftWidth - rightWidth;
        if (leftWidth > 10 && centerWidth > 20) {
          newPanels[0] = leftWidth;
          newPanels[1] = centerWidth;
        }
      } else if (isDraggingRef.current === 'right') {
        const rightWidth = ((totalWidth - x) / totalWidth) * 100;
        const leftWidth = newPanels[0];
        const centerWidth = 100 - leftWidth - rightWidth;
        if (rightWidth > 10 && centerWidth > 20) {
          newPanels[2] = rightWidth;
          newPanels[1] = centerWidth;
        }
      }
      return newPanels;
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = null;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove]);

  const handleMouseDown = useCallback((divider) => (e) => {
    e.preventDefault();
    isDraggingRef.current = divider;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove, handleMouseUp]);

  const handleFileClick = useCallback((filePath, e) => {
    if (e.ctrlKey || e.metaKey) {
      // Multi-select with Ctrl/Cmd
      setActiveFiles(prev => {
        const newSet = new Set(prev);
        if (newSet.has(filePath)) {
          newSet.delete(filePath);
        } else {
          newSet.add(filePath);
        }
        return newSet;
      });
    } else {
      // Single select
      setActiveFiles(new Set([filePath]));
    }
  }, []);

  const activeDraft = useMemo(() => drafts.find(d => d.id === activeDraftId), [drafts, activeDraftId]);
  // AI DraftOps preview/apply/undo state
  const [pendingOps, setPendingOps] = useState(null); // { ops, proposedText, notes }
  const [showPreview, setShowPreview] = useState(false);
  const [undoStack, setUndoStack] = useState([]); // previous contents
  const [redoStack, setRedoStack] = useState([]); // redo contents
  const [diffMode, setDiffMode] = useState('side'); // 'inline' | 'side'

  const updateDraftContent = useCallback((content) => {
    setDrafts(prev => prev.map(d => 
      d.id === activeDraftId ? { ...d, content } : d
    ));
  }, [activeDraftId]);

  const createNewDraft = useCallback(() => {
    const newDraft = {
      id: nextDraftId,
      title: `草稿${nextDraftId}`,
      content: ''
    };
    setDrafts(prev => [...prev, newDraft]);
    setActiveDraftId(nextDraftId);
    setNextDraftId(prev => prev + 1);
  }, [nextDraftId]);

  const closeDraft = useCallback((draftId) => {
    setDrafts(prev => {
      const newDrafts = prev.filter(d => d.id !== draftId);
      if (newDrafts.length === 0) {
        // Create a new draft if all are closed
        const newDraft = { id: nextDraftId, title: `草稿${nextDraftId}`, content: '' };
        setNextDraftId(prev => prev + 1);
        setActiveDraftId(nextDraftId);
        return [newDraft];
      }
      // If active draft was closed, switch to first available
      if (draftId === activeDraftId) {
        setActiveDraftId(newDrafts[0].id);
      }
      return newDrafts;
    });
  }, [activeDraftId, nextDraftId]);

  const startEditingTitle = useCallback((draftId, currentTitle) => {
    setEditingTabId(draftId);
    setEditingTitle(currentTitle);
  }, []);

  const saveTitle = useCallback(() => {
    if (editingTabId && editingTitle.trim()) {
      setDrafts(prev => prev.map(d => 
        d.id === editingTabId ? { ...d, title: editingTitle.trim() } : d
      ));
    }
    setEditingTabId(null);
    setEditingTitle('');
  }, [editingTabId, editingTitle]);

  const cancelEditing = useCallback(() => {
    setEditingTabId(null);
    setEditingTitle('');
  }, []);

  // Diff 预览：基线与选择集
  const beforeText = activeDraft?.content || '';
  const proposedText = pendingOps?.proposedText || '';
  const baselineHunks = useMemo(() => {
    if (!pendingOps) return [];
    return diffLines(beforeText, proposedText);
  }, [pendingOps, beforeText, proposedText]);

  const blockCount = useMemo(() => {
    let count = 0;
    for (let i = 0; i < baselineHunks.length; i++) {
      const h = baselineHunks[i];
      if (h.type === 'equal') continue;
      if (h.type === 'del' && baselineHunks[i + 1]?.type === 'add') { count++; i++; }
      else { count++; }
    }
    return count;
  }, [baselineHunks]);

  const [diffSelections, setDiffSelections] = useState(null);
  const prevSelKey = useRef('');
  useEffect(() => {
    if (!pendingOps) { setDiffSelections(null); prevSelKey.current = 'none'; return; }
    const key = `${beforeText.length}|${proposedText.length}|${blockCount}`;
    if (prevSelKey.current !== key) {
      const sel = {};
      for (let i = 0; i < blockCount; i++) sel[i] = true; // 默认全部采用修改
      setDiffSelections(sel);
      prevSelKey.current = key;
    }
  }, [pendingOps, beforeText, proposedText, blockCount]);

  const chosenAfterText = useMemo(() => {
    if (!pendingOps || !diffSelections) return proposedText || '';
    const out = [];
    let blockIdx = 0;
    for (let i = 0; i < baselineHunks.length; i++) {
      const h = baselineHunks[i];
      if (h.type === 'equal') {
        for (const ln of h.lines) out.push(ln);
        continue;
      }
      const next = baselineHunks[i + 1];
      const accepted = !!diffSelections[blockIdx];
      if (h.type === 'del' && next?.type === 'add') {
        if (accepted) { for (const ln of next.lines) out.push(ln); } else { for (const ln of h.lines) out.push(ln); }
        i++;
        blockIdx++;
      } else if (h.type === 'del') {
        if (!accepted) { for (const ln of h.lines) out.push(ln); }
        blockIdx++;
      } else if (h.type === 'add') {
        if (accepted) { for (const ln of h.lines) out.push(ln); }
        blockIdx++;
      }
    }
    return out.join('\n');
  }, [pendingOps, diffSelections, baselineHunks, proposedText]);

  const toggleBlock = useCallback((idx, accept) => {
    setDiffSelections(prev => ({ ...(prev || {}), [idx]: accept == null ? !prev[idx] : !!accept }));
  }, []);

  return (
    <div 
      ref={containerRef}
      style={{ ...styles.shell, gridTemplateColumns: `${panels[0]}% 4px ${panels[1]}% 4px ${panels[2]}%` }}
    >
      {/* 左栏：PDF 标题与划线笔记 */}
      <aside style={styles.leftPane}>
        <div style={styles.leftHeader}>
          <span>资料与笔记</span>
          <button style={styles.smallBtn} onClick={async () => {
            const paths = await window.api?.openPDFs?.();
            if (!paths?.length) return;
            const res = await window.api?.extractHighlights?.(paths);
            if (res?.ok && res.data?.length) onAdd(res.data);
          }}>添加</button>
        </div>
        <div style={styles.fileList}>
          {files.map(f => (
            <div 
              key={f.path} 
              style={{ 
                ...styles.fileItem, 
                ...(activeFiles.has(f.path) ? styles.fileItemActive : {})
              }} 
              onClick={(e) => handleFileClick(f.path, e)}
            >
              <div style={styles.fileName}>{f.name}</div>
              <div style={styles.fileMeta}>{f.title || '—'}</div>
              <div style={styles.noteCount}>{(f.groups || f.notes || []).length} 组高亮</div>
            </div>
          ))}
        </div>
        <div style={styles.notesWrap}>  {/* 高亮列表 */}
          <div style={styles.notesHeader}>
            已选择 {activeFiles.size} 个文件的高亮内容
          </div>
          <div style={styles.notesContent} className="notes-content">
            {activeGroups.length === 0 ? (
              <div style={styles.empty}>未发现高亮注释。</div>
            ) : (
              activeGroups.map((g, i) => (
                <div key={i} style={styles.noteItem}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {g.fileName} - 第 {g.page} 页 · {g.count} 段
                  </div>
                  {g.contents && g.contents.length ? (
                    <div style={{ fontWeight: 600 }}>{g.contents.join(' / ')}</div>
                  ) : null}
                  <div style={{ opacity: 0.95 }}>{g.text || '（无法从高亮中恢复文字）'}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>

      {/* 左侧调整柄 */}
      <div 
        style={styles.resizeHandle}
        onMouseDown={handleMouseDown('left')}
      />

      {/* 中栏：写作区域（支持在同一窗口内显示 Diff 预览） */}
      <main style={styles.centerPane}>
        <div style={styles.editorHeader}>
          <div style={styles.tabContainer}>
            <div style={styles.tabs}>
              {drafts.map(draft => (
                <div
                  key={draft.id}
                  style={{
                    ...styles.tab,
                    ...(draft.id === activeDraftId ? styles.tabActive : {})
                  }}
                  onClick={() => setActiveDraftId(draft.id)}
                  onDoubleClick={() => startEditingTitle(draft.id, draft.title)}
                >
                  {editingTabId === draft.id ? (
                    <input
                      style={styles.tabTitleInput}
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onBlur={saveTitle}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          saveTitle();
                        } else if (e.key === 'Escape') {
                          cancelEditing();
                        }
                      }}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span style={styles.tabTitle}>{draft.title}</span>
                  )}
                  {drafts.length > 1 && (
                    <button
                      style={styles.tabCloseBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        closeDraft(draft.id);
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button style={styles.newTabBtn} onClick={createNewDraft}>
              +
            </button>
          </div>
          {/* 编辑/对比 视图切换 */}
          <div style={styles.segmented}>
            <button
              style={{ ...styles.segmentBtn, ...(showPreview ? {} : styles.segmentBtnActive) }}
              onClick={() => setShowPreview(false)}
            >
              编辑
            </button>
            <button
              style={{ ...styles.segmentBtn, ...(showPreview ? styles.segmentBtnActive : {}), ...(pendingOps ? {} : { opacity: 0.6, cursor: 'not-allowed' }) }}
              onClick={() => { if (pendingOps) setShowPreview(true); }}
              disabled={!pendingOps}
            >
              对比
            </button>
          </div>
          
          {pendingOps && (
            <button 
              style={{...styles.smallBtn, marginLeft: 8}}
              onClick={() => { setPendingOps(null); setShowPreview(false); }}
            >
              丢弃方案
            </button>
          )}
        </div>
        {showPreview && pendingOps ? (
          <div style={styles.diffWrap}>
            <div style={styles.diffToolbar}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong>AI 修改预览</strong>
                {pendingOps?.notes && (
                  <span style={{ fontSize: 12, opacity: 0.8 }}>摘要：{pendingOps.notes}</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button 
                  style={styles.smallBtn}
                  onClick={() => setDiffMode(m => m === 'inline' ? 'side' : 'inline')}
                >
                  切换为{diffMode === 'inline' ? '双栏' : '单栏'}
                </button>
                <button style={styles.smallBtn} onClick={() => { setShowPreview(false); }}>返回编辑</button>
                <button
                  style={styles.primaryBtn}
                  onClick={() => {
                    const before = activeDraft?.content || '';
                    setUndoStack(prev => [...prev, before]);
                    updateDraftContent(chosenAfterText || '');
                    setRedoStack([]);
                    setShowPreview(false);
                    setPendingOps(null);
                    setChat(c => [...c, { role: 'assistant', content: '已应用 AI 修改并可撤销。' }]);
                  }}
                >
                  应用更改
                </button>
              </div>
            </div>
            <div style={styles.diffStats}>
              <div>原字符: {beforeText.length}</div>
              <div>新字符: {chosenAfterText.length} (Δ {chosenAfterText.length - beforeText.length})</div>
              <div>原行数: {beforeText.split(/\r?\n/).length}</div>
              <div>新行数: {chosenAfterText.split(/\r?\n/).length} (Δ {chosenAfterText.split(/\r?\n/).length - beforeText.split(/\r?\n/).length})</div>
            </div>
            <div style={styles.diffBox}>
              {diffMode === 'inline' ? (
                <InlineDiffView before={beforeText} after={chosenAfterText} />
              ) : (
                diffSelections ? (
                  <DiffViewWithControls before={beforeText} proposed={proposedText} selections={diffSelections} onToggle={toggleBlock} />
                ) : (
                  <div style={{ fontSize: 12, opacity: 0.7 }}>正在准备对比视图…</div>
                )
              )}
            </div>
          </div>
        ) : (
          <textarea
            placeholder="开始写作…（支持从左侧笔记拖拽/复制到此）"
            value={activeDraft?.content || ''}
            onChange={e => updateDraftContent(e.target.value)}
            style={styles.textarea}
          />
        )}
      </main>

      {/* 右侧调整柄 */}
      <div 
        style={styles.resizeHandle}
        onMouseDown={handleMouseDown('right')}
      />

      {/* 右栏：AI 对话 */}
      <section style={styles.rightPane}>
        <div style={styles.chatHeader}>AI 助手</div>
        <div style={styles.chatList}>
          {chat.map((m, i) => (
            <div key={i} style={{ ...styles.chatBubble, ...(m.role === 'user' ? styles.userBubble : styles.aiBubble) }}>
              {m.content}
            </div>
          ))}
        </div>
        <ChatInput onSend={sendMsg} disabled={!chatActive} />
  </section>
      {/* 原弹窗预览已改为中心面板内联显示 */}
    </div>
  );
}

function ChatInput({ onSend, disabled }) {
  const [value, setValue] = useState('');
  return (
    <div style={styles.chatInputWrap}>
      <input
        style={{...styles.chatInput, opacity: disabled ? 0.6 : 1}}
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={disabled ? "AI 正在思考中..." : "向 AI 说明写作需求，回车发送"}
        disabled={disabled}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !disabled) {
            e.preventDefault();
            onSend(value);
            setValue('');
          }
        }}
      />
      <button 
        style={{...styles.primaryBtn, opacity: disabled ? 0.6 : 1}} 
        onClick={() => { 
          if (!disabled) {
            onSend(value); 
            setValue(''); 
          }
        }}
        disabled={disabled}
      >
        {disabled ? '⏳' : '发送'}
      </button>
    </div>
  );
}

// 添加全局滚动条样式
const globalScrollbarStyles = `
  .notes-content::-webkit-scrollbar {
    width: 8px;
  }
  .notes-content::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 4px;
  }
  .notes-content::-webkit-scrollbar-thumb {
    background: #888;
    border-radius: 4px;
  }
  .notes-content::-webkit-scrollbar-thumb:hover {
    background: #555;
  }
`;

// 注入样式到页面
if (typeof document !== 'undefined') {
  const styleElement = document.createElement('style');
  styleElement.innerHTML = globalScrollbarStyles;
  document.head.appendChild(styleElement);
}

const styles = {
  screen: {
    minHeight: '100vh', display: 'grid', placeItems: 'center',
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', padding: 24
  },
  card: { width: 520, maxWidth: '92vw', border: '1px solid #8884', borderRadius: 14, padding: 24 },
  primaryBtn: { padding: '8px 14px', borderRadius: 8, cursor: 'pointer' },
  smallBtn: { padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12 },
  error: { color: '#c00', marginTop: 8 },

  shell: { display: 'grid', width: '100vw', height: '100vh', gap: 0, overflow: 'hidden', background: 'var(--bg,transparent)' },
  leftPane: { borderRight: '1px solid #8883', display: 'grid', gridTemplateRows: 'auto 180px 1fr', minWidth: 0, height: '100vh' },
  leftHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', fontWeight: 600 },
  fileItem: { padding: '8px 10px', borderRadius: 8, border: '1px solid #8883', marginBottom: 6, cursor: 'pointer' },
  fileItemActive: { borderColor: '#4b8efa', background: '#4b8efa22' },
  fileName: { fontSize: 13, wordBreak: 'break-all' },
  noteCount: { opacity: 0.7, fontSize: 12 },
  fileList: { overflow: 'auto', padding: '8px 8px 12px' },
  fileMeta: { fontSize: 12, opacity: 0.7, marginTop: 2 },
  notesWrap: { borderTop: '1px solid #8883', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  notesHeader: { fontWeight: 600, padding: '10px 12px', borderBottom: '1px solid #8883', flexShrink: 0 },
  notesContent: { 
    overflowY: 'scroll', 
    flex: 1, 
    minHeight: 0,
    maxHeight: '100%'
  },
  noteItem: { padding: '8px 12px', borderBottom: '1px dashed #8883' },
  empty: { padding: '10px 12px', opacity: 0.7 },

  centerPane: { display: 'grid', gridTemplateRows: 'auto 1fr' },
  editorHeader: { borderBottom: '1px solid #8883' },
  tabContainer: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px' },
  tabs: { display: 'flex', gap: 4 },
  tab: { 
    display: 'flex', 
    alignItems: 'center', 
    gap: 6, 
    padding: '6px 12px', 
    borderRadius: '6px 6px 0 0', 
    border: '1px solid #8883', 
    borderBottom: 'none',
    background: '#f8f8f8', 
    cursor: 'pointer',
    fontSize: 13
  },
  tabActive: { 
    background: 'white', 
    borderColor: '#4b8efa',
    color: '#4b8efa',
    fontWeight: 600
  },
  tabTitle: { userSelect: 'none' },
  tabTitleInput: { 
    background: 'transparent', 
    border: 'none', 
    outline: 'none', 
    fontSize: 13, 
    fontWeight: 600,
    color: 'inherit',
    width: '80px',
    padding: 0
  },
  tabCloseBtn: { 
    background: 'none', 
    border: 'none', 
    cursor: 'pointer', 
    fontSize: 16, 
    lineHeight: 1,
    padding: 0,
    width: 16,
    height: 16,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  newTabBtn: { 
    background: 'none', 
    border: '1px solid #8883', 
    cursor: 'pointer', 
    fontSize: 14, 
    padding: '4px 8px',
    borderRadius: 4,
    color: '#666'
  },
  textarea: { width: '100%', height: '100%', border: 'none', outline: 'none', padding: 12, fontSize: 15, lineHeight: 1.6, resize: 'none' },
  
  // 内联 Diff 样式
  diffWrap: { display: 'grid', gridTemplateRows: 'auto auto 1fr', height: '100%', overflow: 'hidden' },
  diffToolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #eee' },
  diffStats: { display: 'flex', gap: 16, fontSize: 12, opacity: 0.8, padding: '8px 12px', borderBottom: '1px solid #f0f0f0' },
  diffBox: { maxHeight: '100%', overflow: 'auto', padding: 8 },
  segmented: { display: 'flex', border: '1px solid #8883', borderRadius: 8, overflow: 'hidden' },
  segmentBtn: { background: 'transparent', border: 'none', padding: '6px 10px', cursor: 'pointer', fontSize: 12 },
  segmentBtnActive: { background: '#e9f2ff', color: '#2563eb', fontWeight: 600 },

  rightPane: { display: 'grid', gridTemplateRows: 'auto 1fr auto', overflow: 'hidden', height: '100vh' },
  chatHeader: { padding: '10px 12px', borderBottom: '1px solid #8883', fontWeight: 600 },
  chatList: { padding: 12, overflow: 'auto', minHeight: 0 },
  
  resizeHandle: {
    background: '#ddd',
    cursor: 'col-resize',
    userSelect: 'none',
    borderLeft: '1px solid #bbb',
    borderRight: '1px solid #bbb',
    transition: 'background-color 0.2s',
    '&:hover': {
      background: '#ccc'
    }
  },
  chatBubble: { padding: '8px 10px', borderRadius: 10, marginBottom: 8, maxWidth: '92%' },
  userBubble: { background: '#4b8efa22', border: '1px solid #4b8efa55', marginLeft: 'auto' },
  aiBubble: { background: '#8882', border: '1px solid #8884' },
  chatInputWrap: { display: 'flex', gap: 8, padding: 10, borderTop: '1px solid #8883', position: 'sticky', bottom: 0 },
  chatInput: { flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #8885' }
};

// 预览样式
// 旧弹窗样式移除（改为中间面板内联显示）
