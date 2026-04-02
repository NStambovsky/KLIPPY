const { app, BrowserWindow, Menu, ipcMain, protocol, dialog } = require('electron')
const path = require('path')
const { registerHandlers } = require('./handlers')

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  })

  // Load app
  if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

function buildMenu(win) {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Import Video/Audio...',
          accelerator: 'CmdOrCtrl+O',
          click: () => win.webContents.send('menu:import')
        },
        { type: 'separator' },
        {
          label: 'Export Edit...',
          accelerator: 'CmdOrCtrl+E',
          click: () => win.webContents.send('menu:exportEdit')
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Remove Filler Words',
          click: () => win.webContents.send('menu:removeFillers')
        },
        {
          label: 'Restore All',
          click: () => win.webContents.send('menu:restoreAll')
        },
        { type: 'separator' },
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }]
    }
  ]

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => win.webContents.send('menu:settings')
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
  } else {
    // Add settings to File menu for non-mac
    template[0].submenu.splice(template[0].submenu.length - 1, 0, {
      label: 'Settings',
      accelerator: 'CmdOrCtrl+,',
      click: () => win.webContents.send('menu:settings')
    })
  }

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// Register media:// protocol BEFORE app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true
    }
  }
])

app.whenReady().then(() => {
  // Register media:// protocol handler — uses net.fetch for proper range-request
  // support (needed for video seeking in the <video> element).
  const { net } = require('electron')
  const { pathToFileURL } = require('url')
  protocol.handle('media', (req) => {
    try {
      const filePath = decodeURIComponent(req.url.slice('media://'.length))
      return net.fetch(pathToFileURL(filePath).toString())
    } catch (e) {
      console.error('media:// protocol error:', e)
      return new Response('Not found', { status: 404 })
    }
  })

  const win = createWindow()
  buildMenu(win)
  registerHandlers(ipcMain, win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
