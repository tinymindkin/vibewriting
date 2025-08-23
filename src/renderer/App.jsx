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
      
      const systemPrompt = `你是一个写作助手。用户正在基于PDF文件中的高亮内容进行写作。以下是用户当前选择的高亮内容：\n\n${context}\n\n请基于这些内容帮助用户进行写作，提供有用的建议、总结或扩展。`;
      
      // Get current chat history for context
      const messages = chat.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      }));
      messages.push({ role: 'user', content: msg });
      
      const result = await window.api.aiChat(messages, systemPrompt);
      
      if (result?.ok) {
        setChat(c => [...c, { role: 'assistant', content: result.data.content }]);
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

      {/* 中栏：写作区域 */}
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
        </div>
        <textarea
          placeholder="开始写作…（支持从左侧笔记拖拽/复制到此）"
          value={activeDraft?.content || ''}
          onChange={e => updateDraftContent(e.target.value)}
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
        <ChatInput onSend={sendMsg} disabled={!chatActive} />
      </section>
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

