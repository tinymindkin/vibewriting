import { useMemo, useState, useRef, useCallback } from 'react';

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
  const [activeFile, setActiveFile] = useState(files[0]?.path);
  const [draft, setDraft] = useState('');
  const [chat, setChat] = useState([]); // {role:'user'|'ai', content}
  const [panels, setPanels] = useState([25, 50, 25]); // Percentages for left, center, right
  const containerRef = useRef(null);
  const isDraggingRef = useRef(null); // 'left' | 'right' | null

  const activeFileObj = useMemo(() => files.find(f => f.path === activeFile) || {}, [files, activeFile]);
  const activeGroups = activeFileObj.groups || [];
  const activeName = activeFileObj.name || '';
  const activeTitle = activeFileObj.title || '';

  const sendMsg = (msg) => {
    if (!msg.trim()) return;
    setChat(c => [...c, { role: 'user', content: msg }]);
    // 占位 AI 回复
    setTimeout(() => setChat(c => [...c, { role: 'ai', content: '（AI占位回复：将基于所选 PDF 的笔记进行辅助写作。）' }]), 300);
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
        <div style={styles.notesWrap}>  {/* 高亮列表 */}
          <div style={styles.notesHeader}>来自：{activeTitle || activeName}</div>
          <div style={styles.notesContent} className="notes-content">
            {activeGroups.length === 0 ? (
              <div style={styles.empty}>未发现高亮注释。</div>
            ) : (
              activeGroups.map((g, i) => (
                <div key={i} style={styles.noteItem}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>第 {g.page} 页 · {g.count} 段</div>
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

      {/* 中栏：写作区域 */}
      <main style={styles.centerPane}>
        <div style={styles.editorHeader}>写作区域</div>
        <textarea
          placeholder="开始写作…（支持从左侧笔记拖拽/复制到此）"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          style={styles.textarea}
        />
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
        <ChatInput onSend={sendMsg} />
      </section>
    </div>
  );
}

function ChatInput({ onSend }) {
  const [value, setValue] = useState('');
  return (
    <div style={styles.chatInputWrap}>
      <input
        style={styles.chatInput}
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="向 AI 说明写作需求，回车发送"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSend(value);
            setValue('');
          }
        }}
      />
      <button style={styles.primaryBtn} onClick={() => { onSend(value); setValue(''); }}>发送</button>
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
  leftPane: { borderRight: '1px solid #8883', display: 'grid', gridTemplateRows: 'auto 1fr', minWidth: 0, height: '100vh' },
  leftHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', fontWeight: 600 },
  fileItem: { padding: '8px 10px', borderRadius: 8, border: '1px solid #8883', marginBottom: 6, cursor: 'pointer' },
  fileItemActive: { borderColor: '#4b8efa', background: '#4b8efa22' },
  fileName: { fontSize: 13, wordBreak: 'break-all' },
  noteCount: { opacity: 0.7, fontSize: 12 },
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
  editorHeader: { padding: '10px 12px', borderBottom: '1px solid #8883', fontWeight: 600 },
  textarea: { width: '100%', height: '100%', border: 'none', outline: 'none', padding: 12, fontSize: 15, lineHeight: 1.6, resize: 'none' },

  rightPane: { display: 'grid', gridTemplateRows: 'auto 1fr auto' },
  chatHeader: { padding: '10px 12px', borderBottom: '1px solid #8883', fontWeight: 600 },
  chatList: { padding: 12, overflow: 'auto' },
  
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
  chatInputWrap: { display: 'flex', gap: 8, padding: 10, borderTop: '1px solid #8883' },
  chatInput: { flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #8885' }
};

