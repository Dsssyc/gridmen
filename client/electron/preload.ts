import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
    openTiffFileDialog: () => ipcRenderer.invoke('dialog:openTiffFile'),
    openTxtFileDialog: () => ipcRenderer.invoke('dialog:openTxtFile'),
    openInpFileDialog: () => ipcRenderer.invoke('dialog:openInpFile'),
    openCsvFileDialog: () => ipcRenderer.invoke('dialog:openCsvFile'),
    openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),
    onPatchSelectModeShortcut: (callback: (mode: 'brush' | 'box') => void) => {
        const listener = (_event: Electron.IpcRendererEvent, mode: unknown) => {
            if (mode === 'brush' || mode === 'box') {
                callback(mode)
            }
        }

        ipcRenderer.on('patch:select-mode-shortcut', listener)
        return () => ipcRenderer.removeListener('patch:select-mode-shortcut', listener)
    }
});

console.log('Preload script loaded.');
