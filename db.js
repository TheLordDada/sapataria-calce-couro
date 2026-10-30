// ==================================================
// INDEXEDDB REPOSITORY & REALTIME CLOUD SYNC ENGINE
// Sapataria Calce Couro - Tecnologia de Sincronizacao em Tempo Real (Padrao TaskFlow)
// Utiliza: ntfy.sh (Cloud SSE sub-200ms), BroadcastChannel, IndexedDB Local-First e Google Sheets
// ==================================================

const DB_NAME = 'CalceCouroDB';
const DB_VERSION = 2;
let dbInstance = null;

// URL Oficial do Web App Google Apps Script conectado a Planilha
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzlmXyjnVs5uH41a_9bddnNfIn-M2KMU4arwHreAlRkB0DFw3ziMLeR5MOVRarQy_4r/exec';
const SAPATARIA_SPREADSHEET_ID = '10OhPoBiRADtvGNBFG46NIgVrWUzJCVDoscS_Po3ttXs';

// ==================================================
// 1. INDEXEDDB LOCAL-FIRST
// ==================================================
function openDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) return resolve(dbInstance);

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains('ordens_servico')) {
        const osStore = db.createObjectStore('ordens_servico', { keyPath: 'id', autoIncrement: true });
        osStore.createIndex('numero_os', 'numero_os', { unique: true });
        osStore.createIndex('status', 'status', { unique: false });
        osStore.createIndex('cliente_nome', 'cliente_nome', { unique: false });
        osStore.createIndex('data_entrada', 'data_entrada', { unique: false });
        osStore.createIndex('sincronizado', 'sincronizado', { unique: false });
      }

      if (!db.objectStoreNames.contains('configuracoes')) {
        db.createObjectStore('configuracoes', { keyPath: 'chave' });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('Erro ao abrir IndexedDB:', event.target.error);
      reject(event.target.error);
    };
  });
}

// Obter proximo numero sequencial de OS (#1, #2...)
async function getNextOSNumber() {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('ordens_servico', 'readonly');
    const store = tx.objectStore('ordens_servico');
    const getAllReq = store.getAll();

    getAllReq.onsuccess = () => {
      const items = getAllReq.result || [];
      const maxNum = items.reduce((max, o) => Math.max(max, Number(o.numero_os) || 0), 0);
      resolve(maxNum + 1);
    };

    getAllReq.onerror = () => resolve(1);
  });
}

// Sincroniza uma lista de ordens no IndexedDB com seguranca total contra ConstraintError
async function sincronizarListaOrdensNoBanco(items) {
  if (!Array.isArray(items) || items.length === 0) return false;
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('ordens_servico', 'readwrite');
    const store = tx.objectStore('ordens_servico');

    const getAllReq = store.getAll();
    getAllReq.onsuccess = () => {
      const existingMap = new Map();
      const existingObjs = new Map();

      (getAllReq.result || []).forEach(o => {
        if (o.numero_os != null) {
          const num = Number(o.numero_os);
          existingMap.set(num, o.id);
          existingObjs.set(num, o);
        }
      });

      for (const item of items) {
        const numOS = Number(item.numero_os);
        if (!numOS) continue;

        const localId = existingMap.get(numOS);
        if (localId != null) {
          item.id = localId;
          const oldObj = existingObjs.get(numOS);
          if ((!item.foto_base64 || item.foto_base64 === '[FOTO_SALVA]') && oldObj && oldObj.foto_base64) {
            item.foto_base64 = oldObj.foto_base64;
          }
          store.put(item);
        } else {
          delete item.id;
          store.add(item);
        }
      }
    };

    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => {
      console.error('Erro na transacao de sincronizacao:', tx.error || e);
      reject(tx.error || e);
    };
    tx.onabort = (e) => {
      console.error('Transacao de sincronizacao abortada:', tx.error || e);
      reject(tx.error || e);
    };
  });
}

// Salvar / Atualizar OS Localmente
async function salvarOS(os, dispararSync = true) {
  const db = await openDB();
  return new Promise(async (resolve, reject) => {
    try {
      if (!os.numero_os) {
        os.numero_os = await getNextOSNumber();
      }
      if (!os.data_entrada) {
        os.data_entrada = new Date().toISOString();
      }

      const agora = new Date().toISOString();
      os.atualizado_em = agora;

      // Calcula financeiro
      const totalItens = (os.itens || []).reduce((acc, it) => acc + (parseFloat(it.valor) || 0), 0);
      os.valor_total = totalItens;
      os.valor_entrada = parseFloat(os.valor_entrada) || 0;
      os.valor_restante = Math.max(0, os.valor_total - os.valor_entrada);

      const tx = db.transaction('ordens_servico', 'readwrite');
      const store = tx.objectStore('ordens_servico');
      const request = os.id ? store.put(os) : store.add(os);

      request.onsuccess = (e) => {
        os.id = os.id || e.target.result;
        resolve(os);

        if (dispararSync) {
          RealtimeSync.broadcastLocal('order_saved', os);
          RealtimeSync.pushOrder(os).catch(err => console.warn('Sync offline em fila:', err));
        }
      };

      request.onerror = () => reject(request.error);
    } catch (err) {
      reject(err);
    }
  });
}

// Listar todas as ordens locais
async function listarTodasOS() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('ordens_servico', 'readonly');
    const store = tx.objectStore('ordens_servico');
    const request = store.getAll();

    request.onsuccess = () => {
      const ordens = request.result || [];
      ordens.sort((a, b) => (b.numero_os || b.id) - (a.numero_os || a.id));
      resolve(ordens);
    };

    request.onerror = () => reject(request.error);
  });
}

// Obter OS por ID
async function obterOSPorId(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('ordens_servico', 'readonly');
    const store = tx.objectStore('ordens_servico');
    const request = store.get(Number(id));

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Obter OS por Numero Sequencial
async function obterOSPorNumero(numOS) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('ordens_servico', 'readonly');
    const store = tx.objectStore('ordens_servico');
    const index = store.index('numero_os');
    const request = index.get(Number(numOS));

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Excluir OS
async function excluirOS(id) {
  const os = await obterOSPorId(id);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('ordens_servico', 'readwrite');
    const store = tx.objectStore('ordens_servico');
    const request = store.delete(Number(id));

    request.onsuccess = () => {
      resolve(true);
      if (os && os.numero_os) {
        RealtimeSync.broadcastLocal('order_deleted', { numero_os: os.numero_os });
        RealtimeSync.deleteOrder(os.numero_os).catch(console.warn);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

// Exportar Backup Completo JSON
async function exportarBackupJSON() {
  const ordens = await listarTodasOS();
  const backup = {
    versao: '3.0',
    data_backup: new Date().toISOString(),
    empresa: 'Sapataria Calce Couro',
    total_ordens: ordens.length,
    ordens: ordens
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dataFormatada = new Date().toISOString().split('T')[0];
  a.download = `backup_calce_couro_${dataFormatada}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Importar Backup JSON
async function importarBackupJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const dados = JSON.parse(e.target.result);
        if (!dados.ordens || !Array.isArray(dados.ordens)) {
          throw new Error('Arquivo de backup inválido.');
        }

        await sincronizarListaOrdensNoBanco(dados.ordens);
        RealtimeSync.syncAll();
        resolve(dados.ordens.length);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// ==================================================
// 2. MOTOR DE SINCRONIZAÇÃO EM TEMPO REAL (PADRÃO TASKFLOW)
// ==================================================
const RealtimeSync = {
  channel: 'calcecouro_oficina_2026',
  sessionId: 'ses_' + Math.random().toString(36).substring(2, 9),
  eventSource: null,
  pollTimer: null,
  appStartTime: Date.now(),
  processedMessageIds: new Set(),
  dataChangeListeners: [],
  statusChangeListeners: [],
  isCheckingRemote: false,

  init() {
    this.setupBroadcastChannel();
    this.connectCloudSSE();
    this.startFastCloudPolling();
  },

  getPublishUrl() {
    return `https://ntfy.sh/${this.channel}`;
  },

  getStreamUrl() {
    return `https://ntfy.sh/${this.channel}/sse`;
  },

  getPollUrl() {
    return `https://ntfy.sh/${this.channel}/json?poll=1&since=all`;
  },

  onDataChange(fn) {
    if (typeof fn === 'function') this.dataChangeListeners.push(fn);
  },

  onStatusChange(fn) {
    if (typeof fn === 'function') this.statusChangeListeners.push(fn);
  },

  triggerDataChange(reason, data) {
    this.dataChangeListeners.forEach(fn => {
      try { fn(reason, data); } catch (e) { console.error(e); }
    });
  },

  notifyStatus(status, details = {}) {
    this.statusChangeListeners.forEach(fn => {
      try { fn(status, details); } catch (e) { console.error(e); }
    });
  },

  // 1. Canal entre Abas no mesmo navegador
  setupBroadcastChannel() {
    try {
      this.channelLocal = new BroadcastChannel('calcecouro_local_channel');
      this.channelLocal.onmessage = (event) => {
        if (!event.data) return;
        const { type, payload } = event.data;
        this.triggerDataChange(type, payload);
      };
    } catch(e) {}
  },

  broadcastLocal(type, payload) {
    try {
      if (this.channelLocal) {
        this.channelLocal.postMessage({ type, payload });
      }
    } catch(e) {}
  },

  // 2. Conexão SSE Instantânea na Nuvem (ntfy.sh) - sub-200ms
  connectCloudSSE() {
    if (this.eventSource) {
      try { this.eventSource.close(); } catch(e) {}
    }

    try {
      this.eventSource = new EventSource(this.getStreamUrl());
      this.eventSource.onopen = () => {
        this.notifyStatus('synced', { mode: 'cloud_sse' });
      };

      this.eventSource.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.event === 'message' && data.id) {
            if (this.processedMessageIds.has(data.id)) return;
            this.processedMessageIds.add(data.id);
            const payload = await this.extractPayload(data);
            if (payload) {
              const isRecent = payload.timestamp ? (Date.now() - payload.timestamp < 60000) : false;
              const isAfterStartup = (Date.now() - this.appStartTime > 2000);
              const shouldNotify = isRecent && isAfterStartup;
              await this.handleIncomingAction(payload, shouldNotify);
            }
          }
        } catch(err) {
          console.error('Erro ao processar mensagem nuvem:', err);
        }
      };

      this.eventSource.onerror = () => {
        this.notifyStatus('offline');
      };
    } catch(err) {
      this.notifyStatus('offline');
    }
  },

  async extractPayload(data) {
    if (!data) return null;
    if (data.attachment && data.attachment.url) {
      try {
        const fileRes = await fetch(data.attachment.url);
        if (fileRes.ok) return await fileRes.json();
      } catch(e) {}
    }
    if (data.message) {
      try {
        return JSON.parse(data.message);
      } catch(e) {}
    }
    return null;
  },

  // Processa ação vinda da nuvem (outro celular / PC)
  async handleIncomingAction(payload, shouldNotify = true) {
    if (!payload || !payload.type) return;
    if (payload.sessionId && payload.sessionId === this.sessionId) return;

    if (payload.type === 'order_saved' && payload.order) {
      await sincronizarListaOrdensNoBanco([payload.order]);
      this.notifyStatus('synced');
      this.triggerDataChange('order_saved', payload.order);
      if (shouldNotify) {
        if (window.mostrarNotificacaoToast) {
          mostrarNotificacaoToast(`👞 Pedido #${payload.order.numero_os} (${payload.order.cliente_nome || 'Cliente'}) recebido!`, 'fa-cloud-arrow-down', '#10b981');
        }
        if (window.tocarSomSucesso) tocarSomSucesso();
        if (window.AndroidApp && window.AndroidApp.vibratePhone) {
          window.AndroidApp.vibratePhone(150);
        } else if (navigator.vibrate) {
          navigator.vibrate(150);
        }
      }
    } else if (payload.type === 'status_changed') {
      const existing = await obterOSPorNumero(payload.numero_os);
      if (existing) {
        existing.status = payload.status;
        existing.atualizado_em = payload.atualizado_em || new Date().toISOString();
        if (payload.autor) existing.sincronizado_por = payload.autor;
        await salvarOS(existing, false);
        this.notifyStatus('synced');
        this.triggerDataChange('status_changed', existing);
        if (shouldNotify) {
          if (window.mostrarNotificacaoToast) {
            mostrarNotificacaoToast(`✓ Pedido #${payload.numero_os} mudou para: ${payload.status}`, 'fa-rotate', '#f59e0b');
          }
          if (window.tocarSomSucesso) tocarSomSucesso();
        }
      }
    } else if (payload.type === 'order_deleted') {
      const existing = await obterOSPorNumero(payload.numero_os);
      if (existing) {
        const db = await openDB();
        const tx = db.transaction('ordens_servico', 'readwrite');
        tx.objectStore('ordens_servico').delete(existing.id);
        await new Promise(r => tx.oncomplete = r);
        this.triggerDataChange('order_deleted', payload);
        if (shouldNotify && window.mostrarNotificacaoToast) {
          mostrarNotificacaoToast(`🗑️ Pedido #${payload.numero_os} excluído`, 'fa-trash', '#ef4444');
        }
      }
    }
  },

  // Publicar ação na Nuvem Instantânea (ntfy.sh)
  async publishCloud(actionData) {
    actionData.sessionId = this.sessionId;
    actionData.timestamp = Date.now();

    try {
      const payloadStr = JSON.stringify(actionData);
      const headers = {};
      if (payloadStr.length > 3500) {
        headers['Filename'] = 'payload.json';
      }
      await fetch(this.getPublishUrl(), {
        method: 'POST',
        headers: headers,
        body: payloadStr
      });
      this.notifyStatus('synced');
    } catch(err) {
      console.warn('Erro ao publicar na nuvem ntfy:', err);
    }
  },

  // Enviar Ordem para Nuvem e Planilha
  async pushOrder(os) {
    const autor = localStorage.getItem('calce_operador_nome') || 'Oficina (Pais)';
    os.sincronizado_por = autor;

    this.notifyStatus('syncing');

    // 1. Publica na Nuvem em Tempo Real Instantâneo (ntfy.sh - < 200ms)
    this.publishCloud({
      type: 'order_saved',
      order: os,
      autor: autor
    }).catch(console.warn);

    // 2. Se houver servidor Node local no mesmo Wi-Fi, envia também
    if (window.location.protocol.startsWith('http')) {
      try {
        fetch('/api/sapataria/ordens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(os)
        }).catch(() => {});
      } catch(e) {}
    }

    // 3. Salva também no Google Sheets em segundo plano (Registro Permanente)
    this.pushGoogleSheets(os, autor).catch(err => {
      console.warn('Google Sheets sync em fila:', err);
    });

    return true;
  },

  // Atualizar Status Rápido no Servidor & Nuvem
  async updateStatus(numero_os, novoStatus) {
    const autor = localStorage.getItem('calce_operador_nome') || 'Oficina (Pais)';

    // Atualiza localmente no IndexedDB
    const existing = await obterOSPorNumero(numero_os);
    if (existing) {
      existing.status = novoStatus;
      existing.atualizado_em = new Date().toISOString();
      await salvarOS(existing, false);
      this.broadcastLocal('status_changed', existing);
      this.triggerDataChange('status_changed', existing);
    }

    // Publica na Nuvem em Tempo Real Instantâneo (< 200ms)
    this.publishCloud({
      type: 'status_changed',
      numero_os: numero_os,
      status: novoStatus,
      autor: autor,
      atualizado_em: new Date().toISOString()
    }).catch(console.warn);

    // Envia ao servidor Node se disponível
    if (window.location.protocol.startsWith('http')) {
      fetch(`/api/sapataria/ordens/${numero_os}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: novoStatus, autor })
      }).catch(console.warn);
    }

    // Envia ao Google Sheets
    const code = `
    (function() {
      var ss = SpreadsheetApp.openById('${SAPATARIA_SPREADSHEET_ID}');
      var sheet = ss.getSheetByName('Ordens');
      if (!sheet) return { error: 'Aba nao encontrada' };
      var data = sheet.getDataRange().getValues();
      var numOS = Number(${Number(numero_os)});
      for (var i = 1; i < data.length; i++) {
        if (Number(data[i][0]) === numOS) {
          sheet.getRange(i + 1, 10).setValue(${JSON.stringify(novoStatus)});
          sheet.getRange(i + 1, 13).setValue(new Date().toISOString());
          sheet.getRange(i + 1, 14).setValue(${JSON.stringify(autor)});
          return { success: true };
        }
      }
      return { error: 'OS nao encontrada' };
    })()
    `;
    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'execute_command', code })
    }).catch(console.warn);
  },

  // Deletar Ordem no Servidor & Nuvem
  async deleteOrder(numero_os) {
    this.publishCloud({
      type: 'order_deleted',
      numero_os: numero_os
    }).catch(console.warn);

    if (window.location.protocol.startsWith('http')) {
      fetch(`/api/sapataria/ordens/${numero_os}`, {
        method: 'DELETE'
      }).catch(console.warn);
    }

    const code = `
    (function() {
      var ss = SpreadsheetApp.openById('${SAPATARIA_SPREADSHEET_ID}');
      var sheet = ss.getSheetByName('Ordens');
      if (!sheet) return;
      var data = sheet.getDataRange().getValues();
      var numOS = Number(${Number(numero_os)});
      for (var i = 1; i < data.length; i++) {
        if (Number(data[i][0]) === numOS) {
          sheet.deleteRow(i + 1);
          return { deleted: true };
        }
      }
    })()
    `;
    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'execute_command', code })
    }).catch(console.warn);
  },

  // Salva no Google Sheets
  async pushGoogleSheets(os, autor) {
    const code = `
    (function() {
      var ss = SpreadsheetApp.openById('${SAPATARIA_SPREADSHEET_ID}');
      var sheet = ss.getSheetByName('Ordens');
      if (!sheet) {
        sheet = ss.insertSheet('Ordens');
        sheet.getRange(1, 1, 1, 14).setValues([[
          'ID', 'Data Entrada', 'Cliente', 'Telefone', 'Itens',
          'Previsao Retirada', 'Valor Total', 'Entrada Paga', 'Restante',
          'Status', 'Observacoes', 'Foto', 'Ultima Atualizacao', 'SincronizadoPor'
        ]]).setFontWeight('bold').setBackground('#2b1d1a').setFontColor('#ffffff');
        sheet.setFrozenRows(1);
      }

      var os = ${JSON.stringify(os)};
      var autor = ${JSON.stringify(autor)};
      var numOS = Number(os.numero_os);
      var data = sheet.getDataRange().getValues();
      var rowIndex = -1;

      for (var i = 1; i < data.length; i++) {
        if (Number(data[i][0]) === numOS) {
          rowIndex = i + 1;
          break;
        }
      }

      var previsaoCompleta = (os.previsao_retirada_data || '') + (os.previsao_retirada_hora ? ' às ' + os.previsao_retirada_hora : '');
      var itensStr = JSON.stringify(os.itens || []);
      var agora = new Date().toISOString();

      var rowValues = [
        numOS,
        os.data_entrada || agora,
        os.cliente_nome || '',
        os.cliente_whatsapp || '',
        itensStr,
        previsaoCompleta,
        Number(os.valor_total) || 0,
        Number(os.valor_entrada) || 0,
        Number(os.valor_restante) || 0,
        os.status || 'Aguardando Início',
        os.observacoes || '',
        os.foto_base64 ? (os.foto_base64.length > 500 ? '[FOTO_SALVA]' : os.foto_base64) : '',
        agora,
        autor
      ];

      if (rowIndex > 0) {
        sheet.getRange(rowIndex, 1, 1, 14).setValues([rowValues]);
      } else {
        sheet.appendRow(rowValues);
      }
      return { success: true, numero_os: numOS };
    })()
    `;

    return fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'execute_command', code })
    });
  },

  // 4. Polling Rapido Inteligente (Zero F5 em qualquer rede)
  startFastCloudPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);

    // Roda sync completo inicial
    this.syncAll();

    // Roda a cada 3.5 segundos checando nuvem ntfy
    this.pollTimer = setInterval(async () => {
      if (document.hidden) return;
      await this.checkNtfyPoll();
    }, 3500);

    // Checa Google Sheets periodicamente (a cada 25s) para auditoria completa
    setInterval(async () => {
      if (!document.hidden) {
        await this.checkGoogleSheetsFull();
      }
    }, 25000);

    window.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.checkNtfyPoll();
        this.checkGoogleSheetsFull();
      }
    });
    window.addEventListener('focus', () => {
      this.checkNtfyPoll();
    });
    window.addEventListener('touchstart', () => {
      if (Date.now() - (this.lastTouchCheck || 0) > 3000) {
        this.lastTouchCheck = Date.now();
        this.checkNtfyPoll();
      }
    }, { passive: true });
  },

  async checkNtfyPoll() {
    try {
      const res = await fetch(this.getPollUrl());
      if (!res.ok) return;
      const text = await res.text();
      const lines = text.trim().split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.event === 'message' && data.id) {
            if (!this.processedMessageIds.has(data.id)) {
              this.processedMessageIds.add(data.id);
              const payload = await this.extractPayload(data);
              if (payload) {
                const isRecent = payload.timestamp ? (Date.now() - payload.timestamp < 60000) : false;
                const isAfterStartup = (Date.now() - this.appStartTime > 2000);
                await this.handleIncomingAction(payload, isRecent && isAfterStartup);
              }
            }
          }
        } catch(e) {}
      }
      this.notifyStatus('synced');
    } catch(e) {}
  },

  async checkGoogleSheetsFull() {
    if (this.isCheckingRemote) return;
    this.isCheckingRemote = true;
    try {
      const code = `
      (function() {
        var ss = SpreadsheetApp.openById('${SAPATARIA_SPREADSHEET_ID}');
        var sheet = ss.getSheetByName('Ordens');
        if (!sheet) return [];
        var data = sheet.getDataRange().getValues();
        if (data.length <= 1) return [];
        var list = [];
        for (var i = 1; i < data.length; i++) {
          var row = data[i];
          if (!row[0] && !row[2]) continue;
          var itens = [];
          try {
            itens = typeof row[4] === 'string' && row[4].startsWith('[') ? JSON.parse(row[4]) : [{ nome: 'Conserto', servico: String(row[4] || ''), valor: Number(row[6]) || 0 }];
          } catch(e) {
            itens = [{ nome: 'Servico', servico: String(row[4] || ''), valor: Number(row[6]) || 0 }];
          }
          var prevParts = String(row[5] || '').split(/\\s+[àa]s\\s+/i);
          list.push({
            numero_os: Number(row[0]) || i,
            data_entrada: String(row[1] || ''),
            cliente_nome: String(row[2] || ''),
            cliente_whatsapp: String(row[3] || ''),
            itens: itens,
            previsao_retirada_data: prevParts[0] || '',
            previsao_retirada_hora: prevParts[1] || '',
            valor_total: Number(row[6]) || 0,
            valor_entrada: Number(row[7]) || 0,
            valor_restante: Number(row[8]) || 0,
            status: String(row[9] || 'Aguardando Inicio'),
            observacoes: String(row[10] || ''),
            foto_base64: String(row[11] || ''),
            atualizado_em: String(row[12] || ''),
            sincronizado_por: String(row[13] || '')
          });
        }
        return list;
      })()
      `;

      const res = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'execute_command', code })
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.result)) {
        await sincronizarListaOrdensNoBanco(data.result);
        this.notifyStatus('synced');
        this.triggerDataChange('sheets_sync', data.result);
      }
    } catch(e) {
    } finally {
      this.isCheckingRemote = false;
    }
  },

  // Sincronizacao manual imediata
  async syncAll() {
    this.notifyStatus('syncing');
    await this.checkNtfyPoll();
    await this.checkGoogleSheetsFull();
    this.notifyStatus('synced');
  }
};

const CloudSync = {
  sync: () => RealtimeSync.syncAll(),
  pushOrder: (os) => RealtimeSync.pushOrder(os),
  updateStatus: (num, st) => RealtimeSync.updateStatus(num, st),
  deleteOrder: (num) => RealtimeSync.deleteOrder(num),
  onStatusChange: (fn) => RealtimeSync.onStatusChange(fn),
  startAutoSync: () => {}
};
