import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
    openTiffFileDialog: () => ipcRenderer.invoke('dialog:openTiffFile'),
    openTxtFileDialog: () => ipcRenderer.invoke('dialog:openTxtFile'),
    openInpFileDialog: () => ipcRenderer.invoke('dialog:openInpFile'),
    openCsvFileDialog: () => ipcRenderer.invoke('dialog:openCsvFile'),
    openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder')
});

console.log('Preload script loaded.');
