import React, { useRef, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Folder, File as FileIcon, X, ArrowLeft, ExternalLink, RefreshCw, AlertCircle, Info, Download, Trash2, Edit2, Plus, UploadCloud, Save, FilePlus, FolderPlus, FileCode2, FileJson, Image as ImageIcon, FileText, Archive, TerminalSquare, Loader2 } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

type Toast = { id: number; message: string; type: 'error' | 'info' };

type DialogState = {
  isOpen: boolean;
  type: 'create' | 'rename' | 'delete' | null;
  targetPath?: string;
  targetName?: string;
  isDir?: boolean;
  inputValue: string;
  isLoading: boolean;
};

const getFileIcon = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js': case 'jsx': case 'ts': case 'tsx': return <FileCode2 size={16} className="text-yellow-400 shrink-0" />;
    case 'json': return <FileJson size={16} className="text-green-400 shrink-0" />;
    case 'md': case 'txt': return <FileText size={16} className="text-zinc-300 shrink-0" />;
    case 'png': case 'jpg': case 'jpeg': case 'svg': case 'gif': case 'ico': return <ImageIcon size={16} className="text-purple-400 shrink-0" />;
    case 'zip': case 'tar': case 'gz': case 'rar': return <Archive size={16} className="text-red-400 shrink-0" />;
    case 'sh': case 'bash': return <TerminalSquare size={16} className="text-green-500 shrink-0" />;
    default: return <FileIcon size={16} className="text-zinc-500 shrink-0" />;
  }
};

export default function App() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [currentDir, setCurrentDir] = useState<string>('/');
  const [files, setFiles] = useState<any[]>([]);
  const [viewingFile, setViewingFile] = useState<{name: string, path: string, content: string} | null>(null);
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [portInput, setPortInput] = useState('8080');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [dialog, setDialog] = useState<DialogState>({ isOpen: false, type: null, inputValue: '', isLoading: false });
  const toastIdRef = useRef(0);

  const addToast = (message: string, type: 'error' | 'info' = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files) as File[];
    if (droppedFiles.length === 0) return;

    const formData = new FormData();
    droppedFiles.forEach(file => formData.append('files', file));

    try {
      const res = await fetch(`/api/upload?path=${encodeURIComponent(currentDir)}`, {
        method: 'POST',
        body: formData
      });
      if (!res.ok) throw new Error(await res.text());
      fetchFiles(currentDir);
      addToast(`Uploaded ${droppedFiles.length} file(s) successfully`, 'info');
    } catch (err: any) {
      addToast(`Upload failed: ${err.message}`, 'error');
    }
  };

  const saveFile = async () => {
    if (!viewingFile) return;
    setIsSaving(true);
    try {
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: viewingFile.path, content: editContent })
      });
      if (!res.ok) throw new Error(await res.text());
      addToast('File saved successfully', 'info');
      setViewingFile({ ...viewingFile, content: editContent });
    } catch (e: any) {
      addToast(`Failed to save: ${e.message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const downloadFile = (filePath: string) => {
    window.open(`/api/download?path=${encodeURIComponent(filePath)}`, '_blank');
  };

  const openDeleteDialog = (path: string, name: string) => {
    setDialog({ isOpen: true, type: 'delete', targetPath: path, targetName: name, inputValue: '', isLoading: false });
  };

  const openRenameDialog = (path: string, name: string) => {
    setDialog({ isOpen: true, type: 'rename', targetPath: path, targetName: name, inputValue: name, isLoading: false });
  };

  const openCreateDialog = (isDir: boolean) => {
    setDialog({ isOpen: true, type: 'create', isDir, inputValue: '', isLoading: false });
  };

  const handleDialogSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dialog.type) return;
    
    setDialog(prev => ({ ...prev, isLoading: true }));
    try {
      if (dialog.type === 'create') {
        const targetPath = `${currentDir}/${dialog.inputValue}`.replace(/\/\//g, '/');
        const res = await fetch('/api/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: targetPath, isDir: dialog.isDir })
        });
        if (!res.ok) throw new Error(await res.text());
        addToast(`${dialog.isDir ? 'Folder' : 'File'} created successfully`, 'info');
      } else if (dialog.type === 'rename') {
        if (dialog.inputValue === dialog.targetName) {
          setDialog(prev => ({ ...prev, isOpen: false }));
          return;
        }
        const newPath = dialog.targetPath!.substring(0, dialog.targetPath!.lastIndexOf('/')) + '/' + dialog.inputValue;
        const res = await fetch('/api/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldPath: dialog.targetPath, newPath })
        });
        if (!res.ok) throw new Error(await res.text());
        addToast('Renamed successfully', 'info');
      } else if (dialog.type === 'delete') {
        const res = await fetch(`/api/delete?path=${encodeURIComponent(dialog.targetPath!)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(await res.text());
        addToast('Deleted successfully', 'info');
      }
      fetchFiles(currentDir);
      setDialog({ isOpen: false, type: null, inputValue: '', isLoading: false });
    } catch (err: any) {
      addToast(`Operation failed: ${err.message}`, 'error');
      setDialog(prev => ({ ...prev, isLoading: false }));
    }
  };

  const fetchFiles = async (dir: string) => {
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(dir)}`);
      const data = await res.json();
      if (res.ok && data.files) {
        setFiles(data.files);
        setCurrentDir(data.currentDir);
      } else {
        addToast(data.error || 'Failed to fetch directory contents', 'error');
      }
    } catch (e: any) {
      addToast(`Network error: ${e.message}`, 'error');
    }
  };

  useEffect(() => {
    fetchFiles(currentDir);
  }, []);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#0C0C0C',
        foreground: '#E0E0E0',
        cursor: '#A0A0A0',
        selectionBackground: '#333333',
        black: '#1A1A1A',
        red: '#F44336',
        green: '#4CAF50',
        yellow: '#FFEB3B',
        blue: '#2196F3',
        magenta: '#E91E63',
        cyan: '#00BCD4',
        white: '#E0E0E0',
        brightBlack: '#4D4D4D',
        brightRed: '#FF5252',
        brightGreen: '#69F0AE',
        brightYellow: '#FFFF00',
        brightBlue: '#448AFF',
        brightMagenta: '#FF4081',
        brightCyan: '#18FFFF',
        brightWhite: '#FFFFFF',
      },
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 14,
      cursorBlink: true,
    });
    
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    const socket = io();

    socket.on('connect', () => {
      socket.emit('start', { cols: term.cols, rows: term.rows });
      addToast('Connected to terminal backend', 'info');
    });

    socket.on('connect_error', (err) => {
      addToast(`Connection error: ${err.message}`, 'error');
    });

    socket.on('data', (data: string) => {
      term.write(data);
    });

    socket.on('disconnect', () => {
      term.writeln('\r\n\x1b[31mDisconnected from backend.\x1b[0m');
      addToast('Disconnected from backend', 'error');
    });

    term.onData((data) => {
      socket.emit('data', data);
    });

    const handleResize = () => {
      fitAddon.fit();
      socket.emit('resize', { cols: term.cols, rows: term.rows });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
      socket.disconnect();
    };
  }, []);

  const handleFileClick = (file: any) => {
    if (file.isDirectory) {
      fetchFiles(file.path);
    } else {
      openFile(file.path, file.name);
    }
  };

  const openFile = async (filePath: string, name: string) => {
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || 'Cannot read file');
      }
      const content = await res.text();
      setViewingFile({ name, path: filePath, content });
      setEditContent(content);
    } catch (e: any) {
      addToast(`Could not open file: ${e.message}`, 'error');
    }
  };

  const goUp = () => {
    const parent = currentDir.split('/').slice(0, -1).join('/') || '/';
    fetchFiles(parent);
  };

  return (
    <div 
      className="flex h-screen w-screen bg-[#0C0C0C] text-[#CCCCCC] overflow-hidden font-sans relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 bg-blue-500/20 border-4 border-blue-500 border-dashed z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-zinc-900 p-6 rounded-xl flex flex-col items-center gap-4 shadow-2xl">
            <UploadCloud size={48} className="text-blue-400" />
            <span className="text-xl font-bold text-white">Drop files to upload to {currentDir}</span>
          </div>
        </div>
      )}

      {/* Sidebar Explorer */}
      <div className="w-64 border-r border-zinc-800 flex flex-col bg-[#111111] shrink-0">
        <div className="p-3 font-bold border-b border-zinc-800 text-sm flex items-center justify-between text-zinc-300">
          <span>Explorer</span>
          <div className="flex items-center gap-1">
            <button onClick={() => openCreateDialog(false)} className="p-1 hover:bg-zinc-700 rounded text-zinc-400 hover:text-white transition-colors" title="New File">
              <FilePlus size={14} />
            </button>
            <button onClick={() => openCreateDialog(true)} className="p-1 hover:bg-zinc-700 rounded text-zinc-400 hover:text-white transition-colors" title="New Folder">
              <FolderPlus size={14} />
            </button>
            <button onClick={() => fetchFiles(currentDir)} className="p-1 hover:bg-zinc-700 rounded text-zinc-400 hover:text-white transition-colors" title="Refresh">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
        <div className="p-2 border-b border-zinc-800 flex items-center gap-2 text-xs text-zinc-400 bg-[#1A1A1A]">
          <button onClick={goUp} className="hover:text-white p-1 rounded hover:bg-zinc-700 transition-colors">
            <ArrowLeft size={14} />
          </button>
          <span className="truncate flex-1" title={currentDir}>{currentDir}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-2 text-sm space-y-1 scrollbar-thin scrollbar-thumb-zinc-700">
          {files.map((f, i) => (
            <div 
              key={i} 
              className="group flex items-center justify-between p-1.5 hover:bg-zinc-800 rounded cursor-pointer text-zinc-300 hover:text-white transition-colors"
            >
              <div className="flex items-center gap-2 overflow-hidden flex-1" onClick={() => handleFileClick(f)}>
                {f.isDirectory ? <Folder size={16} className="text-blue-400 shrink-0" /> : getFileIcon(f.name)}
                <span className="truncate">{f.name}</span>
              </div>
              <div className="hidden group-hover:flex items-center gap-1 shrink-0 bg-zinc-800 pl-2">
                {!f.isDirectory && (
                  <button onClick={(e) => { e.stopPropagation(); downloadFile(f.path); }} className="p-1 hover:text-blue-400 transition-colors" title="Download">
                    <Download size={14} />
                  </button>
                )}
                <button onClick={(e) => { e.stopPropagation(); openRenameDialog(f.path, f.name); }} className="p-1 hover:text-yellow-400 transition-colors" title="Rename">
                  <Edit2 size={14} />
                </button>
                <button onClick={(e) => { e.stopPropagation(); openDeleteDialog(f.path, f.name); }} className="p-1 hover:text-red-400 transition-colors" title="Delete">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {files.length === 0 && <div className="text-zinc-600 text-center mt-4 text-xs">Directory is empty</div>}
        </div>
      </div>

      {/* Main Terminal Area */}
      <div className="flex-1 flex flex-col relative min-w-0">
        {/* Header */}
        <div className="h-12 border-b border-zinc-800 flex items-center px-4 text-sm text-zinc-400 justify-between bg-[#0C0C0C]">
          <div className="font-semibold text-zinc-300 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            Ubuntu Terminal
          </div>
          <div className="flex items-center gap-3 bg-zinc-900 p-1.5 rounded-md border border-zinc-800">
            <span className="text-xs">Exposed Port:</span>
            <input 
              type="text" 
              value={portInput}
              onChange={(e) => setPortInput(e.target.value)}
              className="bg-zinc-950 text-white px-2 py-1 rounded w-16 text-xs border border-zinc-700 outline-none focus:border-blue-500" 
            />
            <button 
              onClick={() => {
                if (!portInput || isNaN(Number(portInput))) {
                  addToast('Please enter a valid port number', 'error');
                  return;
                }
                window.open(`/proxy/${portInput}/`, '_blank');
              }} 
              className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-xs flex items-center gap-1 transition-colors"
            >
              Open <ExternalLink size={12} />
            </button>
          </div>
        </div>
        
        {/* Terminal Container */}
        <div className="flex-1 p-2 relative">
          <div ref={terminalRef} className="absolute inset-2" />
        </div>
      </div>

      {/* File Viewer Modal */}
      {viewingFile && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-8 z-50 backdrop-blur-sm">
          <div className="bg-[#111111] w-full max-w-4xl h-full max-h-[80vh] rounded-xl border border-zinc-700 flex flex-col shadow-2xl">
            <div className="flex justify-between items-center p-4 border-b border-zinc-800 bg-[#1A1A1A] rounded-t-xl">
              <span className="font-bold text-zinc-200 flex items-center gap-2">
                <FileIcon size={18} className="text-zinc-400" />
                {viewingFile.name}
                {editContent !== viewingFile.content && <span className="text-yellow-500 text-xs ml-2">(modified)</span>}
              </span>
              <div className="flex items-center gap-2">
                <button 
                  onClick={saveFile}
                  disabled={isSaving || editContent === viewingFile.content}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-md text-sm transition-colors"
                >
                  <Save size={14} /> {isSaving ? 'Saving...' : 'Save'}
                </button>
                <button 
                  onClick={() => setViewingFile(null)}
                  className="p-1.5 hover:bg-zinc-700 rounded-md text-zinc-400 hover:text-white transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden flex flex-col">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                spellCheck={false}
                className="flex-1 w-full bg-[#111111] text-zinc-300 font-mono text-sm p-4 outline-none resize-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* Dialog Modal */}
      {dialog.isOpen && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center p-4 z-[60] backdrop-blur-sm">
          <div className="bg-[#1A1A1A] border border-zinc-700 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <form onSubmit={handleDialogSubmit}>
              <div className="p-4 border-b border-zinc-800">
                <h3 className="text-lg font-semibold text-white">
                  {dialog.type === 'create' && `Create New ${dialog.isDir ? 'Folder' : 'File'}`}
                  {dialog.type === 'rename' && 'Rename Item'}
                  {dialog.type === 'delete' && 'Confirm Deletion'}
                </h3>
              </div>
              <div className="p-4">
                {dialog.type === 'delete' ? (
                  <p className="text-sm text-zinc-300">
                    Are you sure you want to delete <strong className="text-white">{dialog.targetName}</strong>? This action cannot be undone.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <label className="text-xs text-zinc-400 uppercase tracking-wider font-semibold">Name</label>
                    <input
                      type="text"
                      autoFocus
                      value={dialog.inputValue}
                      onChange={(e) => setDialog(prev => ({ ...prev, inputValue: e.target.value }))}
                      className="w-full bg-[#0C0C0C] border border-zinc-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                      placeholder={`Enter ${dialog.isDir ? 'folder' : 'file'} name...`}
                    />
                  </div>
                )}
              </div>
              <div className="p-4 bg-[#111111] border-t border-zinc-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDialog({ isOpen: false, type: null, inputValue: '', isLoading: false })}
                  className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
                  disabled={dialog.isLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={dialog.isLoading || (dialog.type !== 'delete' && !dialog.inputValue.trim())}
                  className={`px-4 py-2 text-sm rounded-md text-white flex items-center gap-2 transition-colors ${
                    dialog.type === 'delete' 
                      ? 'bg-red-600 hover:bg-red-500 disabled:bg-red-800' 
                      : 'bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800'
                  }`}
                >
                  {dialog.isLoading && <Loader2 size={14} className="animate-spin" />}
                  {dialog.type === 'delete' ? 'Delete' : dialog.type === 'rename' ? 'Rename' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toasts Container */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2 z-50">
        {toasts.map(toast => (
          <div 
            key={toast.id} 
            className={`flex items-center gap-2 px-4 py-3 rounded-md shadow-lg border text-sm animate-in slide-in-from-right-8 fade-in duration-300 ${
              toast.type === 'error' 
                ? 'bg-red-950/90 border-red-900 text-red-200' 
                : 'bg-zinc-900/90 border-zinc-700 text-zinc-200'
            }`}
          >
            {toast.type === 'error' ? <AlertCircle size={16} className="text-red-400 shrink-0" /> : <Info size={16} className="text-blue-400 shrink-0" />}
            <span className="break-words max-w-xs">{toast.message}</span>
            <button 
              onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
              className="ml-2 p-1 hover:bg-white/10 rounded-md shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
