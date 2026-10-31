// ==================================================
// SAPATARIA CALCE COURO - APLICAÇÃO SUPER SIMPLES & INTERATIVA
// Feita para uso ágil, intuitivo e sem complicação no dia a dia
// ==================================================

const app = {
  abaAtiva: 'ativos',
  termoBusca: '',
  ordens: [],
  tipoCalcadoEscolhido: 'Sapato',
  servicosEscolhidos: [],
  fotoBase64: '',
  ordemParaImprimir: null
};

// ==================================================
// INICIALIZAÇÃO
// ==================================================
document.addEventListener('DOMContentLoaded', async () => {
  verificarAutenticacaoInicial();
  await openDB();
  configurarEventosGerais();
  configurarMascaraWhatsApp();
  definirDataPadrao(2); // Padrão: daqui a 2 dias
  configurarSyncRealtime();
  await carregarOrdens();
});

// Som suave de confirmação (sem precisar de arquivos externos)
function tocarSomSucesso() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
    osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.1); // A5

    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.35);
  } catch (e) {
    // Web Audio não suportado ou bloqueado
  }
}

// Máscara automática de WhatsApp: (XX) XXXXX-XXXX
function configurarMascaraWhatsApp() {
  const input = document.getElementById('campoClienteWhats');
  input.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '');
    if (v.length > 11) v = v.slice(0, 11);

    if (v.length > 10) {
      v = v.replace(/^(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    } else if (v.length > 6) {
      v = v.replace(/^(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
    } else if (v.length > 2) {
      v = v.replace(/^(\d{2})(\d{0,5})/, '($1) $2');
    } else if (v.length > 0) {
      v = v.replace(/^(\d*)/, '($1');
    }
    e.target.value = v;
  });
}

// ==================================================
// EVENTOS PRINCIPAIS
// ==================================================
function configurarEventosGerais() {
  // Botão gigante de Novo Conserto
  document.getElementById('btnAbrirNovoConserto').addEventListener('click', abrirNovoConserto);

  // Troca de abas (Na Loja, Prontos, Atrasados, Entregues)
  document.querySelectorAll('.filter-tabs .filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-tabs .filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      app.abaAtiva = btn.getAttribute('data-tab');
      renderizarCards();
    });
  });

  // Busca instantânea
  const inputBusca = document.getElementById('inputBusca');
  const btnClearSearch = document.getElementById('btnClearSearch');
  inputBusca.addEventListener('input', (e) => {
    app.termoBusca = e.target.value.trim().toLowerCase();
    btnClearSearch.style.display = app.termoBusca ? 'block' : 'none';
    renderizarCards();
  });
  btnClearSearch.addEventListener('click', () => {
    inputBusca.value = '';
    app.termoBusca = '';
    btnClearSearch.style.display = 'none';
    renderizarCards();
  });

  // Seleção rápida de tipo de calçado
  document.querySelectorAll('#tipoItemButtons .btn-cat').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#tipoItemButtons .btn-cat').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      app.tipoCalcadoEscolhido = btn.getAttribute('data-tipo');
    });
  });

  // Botões de serviços rápidos com 1 toque
  document.querySelectorAll('.service-quick-buttons .btn-service-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const nome = btn.getAttribute('data-nome');
      const preco = parseFloat(btn.getAttribute('data-preco')) || 0;
      adicionarServicoEscolhido(nome, preco);
    });
  });

  // Botão para escrever outro serviço customizado
  document.getElementById('btnAdicionarOutroServico').addEventListener('click', () => {
    const nome = prompt('Qual é o serviço a fazer no calçado/bolsa?');
    if (!nome) return;
    const precoStr = prompt('Qual é o valor deste serviço (em R$)?', '35.00');
    const preco = parseFloat((precoStr || '0').replace(',', '.')) || 0;
    adicionarServicoEscolhido(nome, preco);
  });

  // Botões de data rápida (Amanhã, 2 dias, 3 dias, etc.)
  document.querySelectorAll('#fastDateButtons .btn-fast-date').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#fastDateButtons .btn-fast-date').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const dias = parseInt(btn.getAttribute('data-dias'), 10);
      definirDataPadrao(dias);
    });
  });

  // Entrada de adiantamento em dinheiro
  document.getElementById('campoValorEntrada').addEventListener('input', recalcularFinanceiroForm);

  // Foto do calçado com compressão
  document.getElementById('campoFotoInput').addEventListener('change', processarUploadFoto);
  document.getElementById('btnApagarFoto').addEventListener('click', apagarFotoForm);

  // Submissão do formulário
  document.getElementById('formConserto').addEventListener('submit', salvarConserto);

  // Modal de Caixa & Backup
  document.getElementById('btnAbrirCaixaModal').addEventListener('click', abrirModalCaixa);
  document.getElementById('btnExportarBackup').addEventListener('click', exportarBackupJSON);
  document.getElementById('inputImportarBackup').addEventListener('change', async (e) => {
    if (e.target.files.length > 0) {
      try {
        const total = await importarBackupJSON(e.target.files[0]);
        alert(`Perfeito! ${total} consertos foram restaurados com sucesso.`);
        await carregarOrdens();
        fecharModalCaixa();
      } catch (err) {
        alert('Erro ao carregar o arquivo de backup: ' + err.message);
      }
    }
  });

  // Impressões
  document.getElementById('btnImprimirTermica').addEventListener('click', imprimirCupomTermicoDireto);
  document.getElementById('btnImprimirA4').addEventListener('click', imprimirFolhaA4DuasVias);
  document.getElementById('btnImprimirRawBT').addEventListener('click', imprimirNoRawBT);
}

// Define data rápida
function definirDataPadrao(dias = 2) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  const dataStr = d.toISOString().split('T')[0];
  document.getElementById('campoDataEntrega').value = dataStr;
}

// ==================================================
// SERVIÇOS NO FORMULÁRIO (SUPER INTUITIVO)
// ==================================================
function adicionarServicoEscolhido(nome, preco) {
  app.servicosEscolhidos.push({
    nome: app.tipoCalcadoEscolhido,
    servico: nome,
    valor: preco
  });

  tocarSomSucesso();
  renderizarServicosEscolhidos();
}

function removerServicoEscolhido(index) {
  app.servicosEscolhidos.splice(index, 1);
  renderizarServicosEscolhidos();
}

function renderizarServicosEscolhidos() {
  const container = document.getElementById('listaServicosEscolhidos') || document.getElementById('listaServicosAdicionados');
  if (!container) return;
  container.innerHTML = '';

  if (app.servicosEscolhidos.length === 0) {
    container.innerHTML = `
      <div style="font-size: 13px; color: #8c736e; text-align: center; padding: 6px;">
        Toque em um ou mais botões acima para adicionar o serviço.
      </div>
    `;
  } else {
    app.servicosEscolhidos.forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = 'service-chosen-row';
      row.innerHTML = `
        <span>👞 ${it.nome} - <strong>${it.servico}</strong></span>
        <div style="display: flex; align-items: center; gap: 8px;">
          <strong>R$ ${it.valor.toFixed(2).replace('.', ',')}</strong>
          <button type="button" class="btn-remove-serv" onclick="removerServicoEscolhido(${idx})" title="Remover"><i class="fa-solid fa-xmark"></i></button>
        </div>
      `;
      container.appendChild(row);
    });
  }

  recalcularFinanceiroForm();
}

function recalcularFinanceiroForm() {
  const total = app.servicosEscolhidos.reduce((acc, it) => acc + it.valor, 0);
  const entrada = parseFloat(document.getElementById('campoValorEntrada').value) || 0;
  const restante = Math.max(0, total - entrada);

  document.getElementById('lblFormValorTotal').textContent = `R$ ${total.toFixed(2).replace('.', ',')}`;
  
  const lblRestante = document.getElementById('lblFormValorRestante');
  lblRestante.textContent = `R$ ${restante.toFixed(2).replace('.', ',')}`;
  if (restante === 0 && total > 0) {
    lblRestante.style.color = '#16a34a';
  } else {
    lblRestante.style.color = '#c25e3e';
  }
}

// Compressão automática da foto
function processarUploadFoto(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX_SIZE = 800;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > MAX_SIZE) {
          height *= MAX_SIZE / width;
          width = MAX_SIZE;
        }
      } else {
        if (height > MAX_SIZE) {
          width *= MAX_SIZE / height;
          height = MAX_SIZE;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      app.fotoBase64 = canvas.toDataURL('image/jpeg', 0.75);
      document.getElementById('imgFotoPreview').src = app.fotoBase64;
      const pBox = document.getElementById('fotoPreviewBox') || document.getElementById('previewFotoContainer'); if (pBox) pBox.style.display = 'block';
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

function apagarFotoForm() {
  app.fotoBase64 = '';
  const campo = document.getElementById('campoFotoInput');
  if (campo) campo.value = '';
  const img = document.getElementById('imgFotoPreview');
  if (img) img.src = '';
  const box = document.getElementById('fotoPreviewBox') || document.getElementById('previewFotoContainer');
  if (box) box.style.display = 'none';
}

// ==================================================
// ABERTURA E SALVAMENTO DO NOVO CONSERTO
// ==================================================
function abrirNovoConserto() {
  const form = document.getElementById('formConserto');
  if (form) form.reset();
  const editId = document.getElementById('editOSId');
  if (editId) editId.value = '';
  const tit = document.getElementById('tituloModalConserto');
  if (tit) tit.textContent = 'Novo Conserto';

  app.servicosEscolhidos = [];
  app.fotoBase64 = '';
  apagarFotoForm();
  definirDataPadrao(2);

  // Adiciona um servico inicial sugerido
  app.servicosEscolhidos.push({
    nome: 'Sapato',
    servico: 'Meia Sola',
    valor: 80.00
  });

  renderizarServicosEscolhidos();
  const modal = document.getElementById('modalNovoConserto');
  if (modal) {
    modal.classList.add('open');
  }
  const nome = document.getElementById('campoClienteNome');
  if (nome) nome.focus();
}

function fecharModalConserto() {
  document.getElementById('modalNovoConserto').classList.remove('open');
}

async function salvarConserto(e) {
  e.preventDefault();

  const clienteNome = document.getElementById('campoClienteNome').value.trim();
  const clienteWhats = document.getElementById('campoClienteWhats').value.trim();
  const previsaoData = document.getElementById('campoDataEntrega').value;
  const previsaoHora = document.getElementById('campoHoraEntrega').value || '17:00';
  const obs = document.getElementById('campoObservacao').value.trim();
  const valorEntrada = parseFloat(document.getElementById('campoValorEntrada').value) || 0;
  const editId = document.getElementById('editOSId').value;

  if (app.servicosEscolhidos.length === 0) {
    alert('Por favor, toque em pelo menos um botão de serviço para registrar o conserto.');
    return;
  }

  let os = null;
  if (editId) {
    os = await obterOSPorId(editId);
  } else {
    os = {
      status: 'Aguardando Início',
      data_entrada: new Date().toISOString()
    };
  }

  os.cliente_nome = clienteNome;
  os.cliente_whatsapp = clienteWhats;
  os.previsao_retirada_data = previsaoData;
  os.previsao_retirada_hora = previsaoHora;
  os.itens = app.servicosEscolhidos;
  os.observacoes = obs;
  os.foto_base64 = app.fotoBase64 || os.foto_base64 || '';
  os.valor_entrada = valorEntrada;

  const salva = await salvarOS(os);
  fecharModalConserto();
  tocarSomSucesso();
  await carregarOrdens();

  // Pergunta diretamente se deseja enviar o comprovante no WhatsApp agora
  const enviarZap = confirm(`🎉 Conserto #${salva.numero_os} salvo com sucesso!\n\nDeseja enviar o comprovante no WhatsApp de ${salva.cliente_nome} agora?`);
  if (enviarZap) {
    enviarZapDireto(salva.id);
  }
}

// ==================================================
// CARREGAR E RENDERIZAR OS CARDS (MEGA INTUITIVOS)
// ==================================================
async function carregarOrdens() {
  app.ordens = await listarTodasOS();
  atualizarContadoresAbas();
  renderizarCards();
}

// Verifica se está atrasado
function estaAtrasado(os) {
  if (os.status === 'Entregue') return false;
  if (!os.previsao_retirada_data) return false;

  const horaStr = os.previsao_retirada_hora || '23:59';
  const dataPrevisao = new Date(`${os.previsao_retirada_data}T${horaStr}:00`);
  return new Date() > dataPrevisao;
}

// Atualiza contadores
function atualizarContadoresAbas() {
  let countAtivos = 0;
  let countProntos = 0;
  let countAtrasados = 0;
  let countFinalizados = 0;

  let entradasHoje = 0;
  let saldoLoja = 0;
  let totalMes = 0;

  const hojeStr = new Date().toISOString().split('T')[0];
  const mesAtual = new Date().getMonth();
  const anoAtual = new Date().getFullYear();

  app.ordens.forEach(os => {
    const dataObj = new Date(os.data_entrada);
    const dataStr = (os.data_entrada || '').split('T')[0];

    if (dataStr === hojeStr) entradasHoje += (os.valor_entrada || 0);
    if (dataObj.getMonth() === mesAtual && dataObj.getFullYear() === anoAtual) totalMes += (os.valor_total || 0);

    const atraso = estaAtrasado(os);

    if (os.status === 'Entregue') {
      countFinalizados++;
    } else {
      countAtivos++;
      saldoLoja += (os.valor_restante || 0);
      if (os.status === 'Pronto para Retirada') countProntos++;
      if (atraso) countAtrasados++;
    }
  });

  document.getElementById('countAtivos').textContent = countAtivos;
  document.getElementById('countProntos').textContent = countProntos;
  document.getElementById('countAtrasados').textContent = countAtrasados;
  document.getElementById('countFinalizados').textContent = countFinalizados;

  // Caixa modal
  const fmtEntradas = `R$ ${entradasHoje.toFixed(2).replace('.', ',')}`;
  const fmtSaldo = `R$ ${saldoLoja.toFixed(2).replace('.', ',')}`;
  const fmtMes = `R$ ${totalMes.toFixed(2).replace('.', ',')}`;

  document.getElementById('caixaEntradasHoje').textContent = fmtEntradas;
  document.getElementById('caixaSaldoLoja').textContent = fmtSaldo;
  document.getElementById('caixaMes').textContent = fmtMes;
}

// Renderiza Cards
function renderizarCards() {
  const container = document.getElementById('gridCardsConsertos');
  const boxVazio = document.getElementById('boxListaVazia');
  container.innerHTML = '';

  let lista = app.ordens.filter(os => {
    const atraso = estaAtrasado(os);

    if (app.abaAtiva === 'ativos') {
      return os.status !== 'Entregue';
    } else if (app.abaAtiva === 'prontos') {
      return os.status === 'Pronto para Retirada';
    } else if (app.abaAtiva === 'atrasados') {
      return atraso;
    } else if (app.abaAtiva === 'finalizados') {
      return os.status === 'Entregue';
    }
    return true;
  });

  // Filtro de busca
  if (app.termoBusca) {
    const q = app.termoBusca;
    lista = lista.filter(os => 
      (os.cliente_nome || '').toLowerCase().includes(q) ||
      (os.cliente_whatsapp || '').toLowerCase().includes(q) ||
      `#${os.numero_os}`.includes(q) ||
      String(os.numero_os).includes(q)
    );
  }

  if (lista.length === 0) {
    boxVazio.style.display = 'block';
    if (app.abaAtiva === 'prontos') {
      document.getElementById('emptyTitle').textContent = 'Nenhum sapato pronto ainda';
      document.getElementById('emptyDesc').textContent = 'Quando você terminar um conserto, mude o status para "Pronto".';
    } else if (app.abaAtiva === 'atrasados') {
      document.getElementById('emptyTitle').textContent = 'Tudo dentro do prazo!';
      document.getElementById('emptyDesc').textContent = 'Nenhum calçado com data de entrega vencida.';
    } else if (app.abaAtiva === 'finalizados') {
      document.getElementById('emptyTitle').textContent = 'Nenhum entregue ainda';
      document.getElementById('emptyDesc').textContent = 'Os calçados que você entregar e receber ficarão aqui.';
    } else {
      document.getElementById('emptyTitle').textContent = 'Bancada livre!';
      document.getElementById('emptyDesc').textContent = 'Nenhum calçado ativo na loja no momento.';
    }
    return;
  }

  boxVazio.style.display = 'none';

  lista.forEach(os => {
    const card = criarCardSapato(os);
    container.appendChild(card);
  });
}

// Criação do Card com BOTÕES DE AÇÃO DIRETA
function criarCardSapato(os) {
  const card = document.createElement('div');
  const atraso = estaAtrasado(os);

  let classeStatus = 'status-espera';
  let badgeClass = 'bg-espera';
  let badgeIcon = '🟡';
  let badgeTexto = 'Na Fila';

  if (atraso) {
    classeStatus = 'status-atrasado';
    badgeClass = 'bg-atrasado';
    badgeIcon = '🔴';
    badgeTexto = 'ATRASADO!';
  } else if (os.status === 'Em conserto') {
    classeStatus = 'status-conserto';
    badgeClass = 'bg-conserto';
    badgeIcon = '🟠';
    badgeTexto = 'Na Bancada';
  } else if (os.status === 'Pronto para Retirada') {
    classeStatus = 'status-pronto';
    badgeClass = 'bg-pronto';
    badgeIcon = '🟢';
    badgeTexto = 'PRONTO P/ RETIRAR';
  } else if (os.status === 'Entregue') {
    classeStatus = 'status-entregue';
    badgeClass = 'bg-entregue';
    badgeIcon = '🏁';
    badgeTexto = 'ENTREGUE';
  }

  card.className = `card-shoe ${classeStatus}`;

  // Formatação amigável de data
  const [anoP, mesP, diaP] = (os.previsao_retirada_data || '2026-01-01').split('-');
  const dataPrevFmt = `${diaP}/${mesP}/${anoP}`;
  const horaPrevFmt = os.previsao_retirada_hora || '17:00';

  // Descrição dos itens
  const primeiroItem = os.itens && os.itens[0] ? os.itens[0] : { nome: 'Calçado', servico: 'Conserto' };
  const totalItens = (os.itens || []).length;
  const outrosItensTexto = totalItens > 1 ? ` (+${totalItens - 1} serviços)` : '';

  // Foto thumbnail
  const fotoHtml = os.foto_base64
    ? `<img src="${os.foto_base64}" class="c-shoe-thumb" alt="Sapato" onclick="abrirFotoGrande('${os.foto_base64}')">`
    : `<div class="c-shoe-thumb" style="background:#f1eae2; display:flex; align-items:center; justify-content:center; font-size:26px;">👞</div>`;

  // Saldo
  const temSaldo = os.valor_restante > 0;
  const saldoClass = temSaldo ? '' : 'paid';
  const saldoTexto = temSaldo ? `R$ ${os.valor_restante.toFixed(2).replace('.', ',')}` : 'PAGO ✅';

  card.innerHTML = `
    <!-- Topo: #OS e Status -->
    <div class="c-top-line">
      <span class="c-os-num">#${os.numero_os}</span>
      <span class="c-badge-status ${badgeClass}">${badgeIcon} ${badgeTexto}</span>
    </div>

    <!-- Cliente -->
    <div class="c-client-box">
      <div class="c-client-name">${os.cliente_nome}</div>
    </div>

    <!-- Foto e O que foi feito -->
    <div class="c-body-flex">
      ${fotoHtml}
      <div class="c-services-info">
        <div class="c-item-title">${primeiroItem.nome}: <strong>${primeiroItem.servico}</strong>${outrosItensTexto}</div>
        ${os.observacoes ? `<div class="c-item-obs"><i class="fa-solid fa-triangle-exclamation"></i> ${os.observacoes}</div>` : ''}
      </div>
    </div>

    <!-- Previsão e Saldo -->
    <div class="c-info-bar">
      <div class="c-delivery-date ${atraso ? 'late' : ''}">
        <span>Fica pronto em:</span>
        <strong>${dataPrevFmt} às ${horaPrevFmt}</strong>
      </div>
      <div class="c-money-due ${saldoClass}">
        <span>${temSaldo ? 'Falta Pagar:' : 'Situação:'}</span>
        <strong>${saldoTexto}</strong>
      </div>
    </div>

    <!-- BOTÕES GRANDES DE AÇÃO DIRETA -->
    <div class="c-direct-actions">
      <button class="btn-c-action btn-c-zap" onclick="enviarZapDireto(${os.id})" title="Enviar WhatsApp com 1 toque">
        <i class="fa-brands fa-whatsapp" style="font-size: 20px;"></i>
        <span>AVISAR NO ZAP</span>
      </button>

      <button class="btn-c-action btn-c-imprimir" onclick="abrirCupomPorId(${os.id})" title="Imprimir cupom">
        <i class="fa-solid fa-print"></i>
        <span>CUPOM</span>
      </button>

      ${os.status !== 'Entregue' ? `
        <button class="btn-c-action btn-c-entregar" onclick="receberEEntregar(${os.id})">
          <i class="fa-solid fa-hand-holding-dollar"></i>
          <span>${temSaldo ? `RECEBER R$ ${os.valor_restante.toFixed(2).replace('.', ',')} & ENTREGAR` : 'ENTREGAR CALÇADO'}</span>
        </button>

        <button class="btn-c-action btn-c-status-rapido" onclick="alternarStatusProximo(${os.id})">
          <i class="fa-solid fa-rotate"></i>
          <span>Mudar para: ${obterProximoStatusTexto(os.status)}</span>
        </button>
      ` : `
        <div style="grid-column: 1/-1; text-align: center; font-size: 13px; font-weight: 800; color: #166534; padding: 6px;">
          🎉 Sapato Entregue e Concluído!
        </div>
      `}
    </div>
  `;

  return card;
}

// Alternar status com 1 toque
function obterProximoStatusTexto(atual) {
  if (atual === 'Aguardando Início') return '🟠 Na Bancada (Consertando)';
  if (atual === 'Em conserto') return '🟢 PRONTO (Avisar Cliente)';
  if (atual === 'Pronto para Retirada') return '🏁 ENTREGUE';
  return '🟡 Na Fila';
}

async function alternarStatusProximo(osId) {
  const os = await obterOSPorId(osId);
  if (!os) return;

  if (os.status === 'Aguardando Início') {
    os.status = 'Em conserto';
  } else if (os.status === 'Em conserto') {
    os.status = 'Pronto para Retirada';
    tocarSomSucesso();
    // Se ficou pronto, já pergunta amigavelmente se quer mandar o zap agora
    if (confirm(`Deseja avisar ${os.cliente_nome} no WhatsApp que o sapato está PRONTO agora?`)) {
      enviarZapDireto(os.id);
    }
  } else if (os.status === 'Pronto para Retirada') {
    await receberEEntregar(osId);
    return;
  }

  await salvarOS(os);
  await carregarOrdens();
}

// Botão direto "Receber e Entregar"
async function receberEEntregar(osId) {
  const os = await obterOSPorId(osId);
  if (!os) return;

  const temSaldo = os.valor_restante > 0;
  let msg = `Confirmar a entrega do sapato para ${os.cliente_nome}?`;
  if (temSaldo) {
    msg = `Confirmar o recebimento de R$ ${os.valor_restante.toFixed(2).replace('.', ',')} em dinheiro/PIX e entregar o sapato?`;
  }

  if (!confirm(msg)) return;

  os.valor_entrada = os.valor_total;
  os.valor_restante = 0;
  os.status = 'Entregue';
  os.data_entrega = new Date().toISOString();

  await salvarOS(os);
  tocarSomSucesso();
  alert('Pronto! Sapato entregue e dinheiro registrado no caixa com sucesso.');
  await carregarOrdens();
}

// ==================================================
// DISPARO INTELIGENTE DE WHATSAPP (1 TOQUE!)
// ==================================================
async function enviarZapDireto(osId) {
  const os = await obterOSPorId(osId);
  if (!os) return;

  const whatsLimpo = (os.cliente_whatsapp || '').replace(/\D/g, '');
  if (!whatsLimpo) {
    alert('Nenhum telefone/WhatsApp cadastrado para este cliente.');
    return;
  }

  const [anoP, mesP, diaP] = (os.previsao_retirada_data || '2026-01-01').split('-');
  const dataPrevFmt = `${diaP}/${mesP}/${anoP}`;
  const horaPrevFmt = os.previsao_retirada_hora || '17:00';
  const restanteFmt = `R$ ${os.valor_restante.toFixed(2).replace('.', ',')}`;

  const itensTexto = (os.itens || []).map(it => `• ${it.nome}: *${it.servico}* (R$ ${it.valor.toFixed(2).replace('.', ',')})`).join('\n');
  let textoMsg = '';

  if (os.status === 'Pronto para Retirada') {
    textoMsg = 
`👞 *SAPATARIA CALCE COURO*
Consertos e Restaurações de Calçados e Bolsas

Olá, *${os.cliente_nome}*! Tudo bem?
🎉 Boas notícias! Seu pedido *#${os.numero_os}* está *PRONTO PARA RETIRADA*! ✨

${itensTexto}

📍 *Endereço:* Avenida Prestes Maia, nº 651
💵 *Saldo a pagar na retirada:* ${restanteFmt}

Pode passar para retirar quando quiser!
📞 Telefone: (18) 3304-6049 | Whats: (18) 99753-2876`;
  } else if (estaAtrasado(os)) {
    textoMsg = 
`👞 *SAPATARIA CALCE COURO*
Olá, *${os.cliente_nome}*!
Passando para dar uma satisfação sobre o seu pedido *#${os.numero_os}*.

Estamos finalizando os últimos detalhes de acabamento com muito capricho para garantir a máxima durabilidade do seu calçado! 🛠️

Assim que estiver 100% pronto, já te avisamos aqui.
📞 Qualquer dúvida: (18) 3304-6049`;
  } else {
    // Comprovante de entrada
    textoMsg = 
`👞 *SAPATARIA CALCE COURO*
Consertos e Restaurações de Calçados e Bolsas
Av. Prestes Maia, nº 651 | Tel: (18) 3304-6049

Olá, *${os.cliente_nome}*! Confirmamos a entrada do seu serviço:

📋 *COMPROVANTE - PEDIDO #${os.numero_os}*
${itensTexto}
${os.observacoes ? `🔍 *Detalhes/Obs:* ${os.observacoes}\n` : ''}
📅 *Previsão de Retirada:* ${dataPrevFmt} às ${horaPrevFmt}
💵 *Valor Total:* R$ ${os.valor_total.toFixed(2).replace('.', ',')}
✅ *Entrada Paga:* R$ ${os.valor_entrada.toFixed(2).replace('.', ',')}
⚠️ *Falta Pagar na Retirada:* ${restanteFmt}

Apresente esta mensagem quando vier retirar seu calçado.
Obrigado pela preferência e confiança!`;
  }

  // Detecta se é celular ou computador para abrir sem quebrar emojis
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  let url = '';
  if (isMobile) {
    url = `https://api.whatsapp.com/send?phone=55${whatsLimpo}&text=${encodeURIComponent(textoMsg)}`;
  } else {
    // No PC (WhatsApp Web direto para não passar pelo wa.me que corrompe emojis em )
    url = `https://web.whatsapp.com/send?phone=55${whatsLimpo}&text=${encodeURIComponent(textoMsg)}`;
  }
  window.open(url, '_blank');
}

// ==================================================
// IMPRESSÃO DE CUPOM TÉRMICO (58mm)
// ==================================================
async function abrirCupomPorId(osId) {
  const os = await obterOSPorId(osId);
  if (!os) return;
  abrirCupomImpressao(os);
}

function abrirCupomImpressao(os) {
  app.ordemParaImprimir = os;

  document.getElementById('cupomNumeroOS').textContent = `PEDIDO #${os.numero_os}`;
  document.getElementById('cupomDataEntrada').textContent = new Date(os.data_entrada).toLocaleString('pt-BR');

  const [anoP, mesP, diaP] = (os.previsao_retirada_data || '2026-01-01').split('-');
  document.getElementById('cupomPrevisao').textContent = `${diaP}/${mesP}/${anoP} ${os.previsao_retirada_hora || '17:00'}`;
  document.getElementById('cupomCliente').textContent = (os.cliente_nome || '').toUpperCase();
  document.getElementById('cupomTelefone').textContent = os.cliente_whatsapp || '(18) 0000-0000';

  const container = document.getElementById('cupomListaServicos');
  container.innerHTML = '';

  (os.itens || []).forEach(it => {
    const row = document.createElement('div');
    row.style.margin = '3px 0';
    row.innerHTML = `
      <div class="tk-bold">${it.nome}</div>
      <div class="tk-row">
        <span style="padding-left: 8px;">${it.servico}</span>
        <span class="tk-bold">R$ ${it.valor.toFixed(2).replace('.', ',')}</span>
      </div>
    `;
    container.appendChild(row);
  });

  document.getElementById('cupomTotal').textContent = `R$ ${os.valor_total.toFixed(2).replace('.', ',')}`;
  document.getElementById('cupomEntrada').textContent = `R$ ${os.valor_entrada.toFixed(2).replace('.', ',')}`;
  document.getElementById('cupomRestante').textContent = `R$ ${os.valor_restante.toFixed(2).replace('.', ',')}`;

  const obsBloco = document.getElementById('cupomObsBloco');
  if (os.observacoes) {
    document.getElementById('cupomObservacao').textContent = os.observacoes;
    obsBloco.style.display = 'block';
  } else {
    obsBloco.style.display = 'none';
  }

  document.getElementById('modalCupom').classList.add('open');
}

function fecharModalCupom() {
  document.getElementById('modalCupom').classList.remove('open');
}

// Impressão Térmica Direta (Isolada, Sem Cabeçalhos do Chrome, Sem Sobras de Papel!)
function imprimirCupomTermicoDireto() {
  const os = app.ordemParaImprimir;
  if (!os) return;

  const [anoP, mesP, diaP] = (os.previsao_retirada_data || '2026-01-01').split('-');
  const dataPrevFmt = `${diaP}/${mesP}/${anoP} ${os.previsao_retirada_hora || '17:00'}`;
  const dataEntradaFmt = new Date(os.data_entrada).toLocaleString('pt-BR');

  let itensHtml = '';
  (os.itens || []).forEach(it => {
    itensHtml += `
      <div style="margin: 3px 0;">
        <div style="font-weight: bold;">${it.nome}</div>
        <div style="display: flex; justify-content: space-between; padding-left: 6px;">
          <span>${it.servico}</span>
          <span style="font-weight: bold;">R$ ${it.valor.toFixed(2).replace('.', ',')}</span>
        </div>
      </div>
    `;
  });

  const obsHtml = os.observacoes ? `<div style="font-size: 10px; margin: 4px 0;"><strong>OBS:</strong> ${os.observacoes}</div>` : '';

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Cupom #${os.numero_os}</title>
      <style>
        @page {
          size: 58mm auto;
          margin: 0mm;
        }
        body {
          margin: 0;
          padding: 3mm 2mm;
          width: 52mm;
          font-family: 'Courier New', Courier, monospace;
          font-size: 11px;
          line-height: 1.2;
          color: #000;
          background: #fff;
        }
        .center { text-align: center; }
        .bold { font-weight: bold; }
        .divider { border-bottom: 1px dashed #000; margin: 4px 0; }
        .double-divider { border-bottom: 2px solid #000; margin: 4px 0; }
        .row { display: flex; justify-content: space-between; margin: 2px 0; }
      </style>
    </head>
    <body>
      <div class="center bold" style="font-size: 13px;">SAPATARIA CALCE COURO</div>
      <div class="center" style="font-size: 10px;">Consertos e Restauracoes</div>
      <div class="center" style="font-size: 10px;">Calcados e Bolsas</div>
      <div class="center" style="font-size: 10px;">Av. Prestes Maia, n 651</div>
      <div class="center" style="font-size: 10px;">Tel: (18) 3304-6049</div>
      <div class="center" style="font-size: 10px;">Whats: (18) 99753-2876</div>
      <div class="double-divider"></div>
      <div class="center bold" style="font-size: 15px;">PEDIDO #${os.numero_os}</div>
      <div class="double-divider"></div>
      <div class="row"><span>Entrada:</span> <span>${dataEntradaFmt}</span></div>
      <div class="row"><span>Retirar:</span> <span class="bold">${dataPrevFmt}</span></div>
      <div class="row"><span>Cliente:</span> <span class="bold">${(os.cliente_nome || '').toUpperCase()}</span></div>
      <div class="row"><span>Telefone:</span> <span>${os.cliente_whatsapp || ''}</span></div>
      <div class="divider"></div>
      <div class="row bold"><span>SERVICO</span><span>VALOR</span></div>
      <div class="divider"></div>
      ${itensHtml}
      <div class="divider"></div>
      <div class="row"><span>TOTAL:</span> <span class="bold">R$ ${os.valor_total.toFixed(2).replace('.', ',')}</span></div>
      <div class="row"><span>ENTRADA PAGA:</span> <span>R$ ${os.valor_entrada.toFixed(2).replace('.', ',')}</span></div>
      <div class="row bold" style="font-size: 14px;"><span>A PAGAR:</span> <span>R$ ${os.valor_restante.toFixed(2).replace('.', ',')}</span></div>
      <div class="double-divider"></div>
      ${obsHtml}
      <div class="center" style="font-size: 9px; margin-top: 8px;">
        Obrigado pela confianca!<br>
        Apresente este papel para retirar.<br>
        Calcados nao retirados em 90 dias<br>poderao ser doados.
      </div>
    </body>
    </html>
  `);
  doc.close();

  iframe.contentWindow.focus();
  setTimeout(() => {
    iframe.contentWindow.print();
    setTimeout(() => document.body.removeChild(iframe), 1500);
  }, 250);
}

// Impressão em Folha A4 Comum (2 Vias Compactas: 1 pro Cliente + 1 pro Sapato!)
function imprimirFolhaA4DuasVias() {
  const os = app.ordemParaImprimir;
  if (!os) return;

  const [anoP, mesP, diaP] = (os.previsao_retirada_data || '2026-01-01').split('-');
  const dataPrevFmt = `${diaP}/${mesP}/${anoP} ${os.previsao_retirada_hora || '17:00'}`;
  const dataEntradaFmt = new Date(os.data_entrada).toLocaleString('pt-BR');

  let itensHtml = '';
  (os.itens || []).forEach(it => {
    itensHtml += `
      <div style="display: flex; justify-content: space-between; margin: 3px 0; font-size: 12px;">
        <span><strong>${it.nome}:</strong> ${it.servico}</span>
        <strong>R$ ${it.valor.toFixed(2).replace('.', ',')}</strong>
      </div>
    `;
  });

  const obsHtml = os.observacoes ? `<div style="font-size: 11px; margin: 4px 0; color: #555;"><strong>Observações:</strong> ${os.observacoes}</div>` : '';

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Pedido #${os.numero_os} - 2 Vias</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 8mm;
        }
        body {
          margin: 0;
          font-family: Arial, sans-serif;
          color: #000;
          background: #fff;
        }
        .container {
          display: flex;
          gap: 12mm;
        }
        .via-card {
          flex: 1;
          border: 1.5px dashed #444;
          border-radius: 8px;
          padding: 6mm;
          box-sizing: border-box;
        }
        .header-title {
          font-size: 14px;
          font-weight: 900;
          text-align: center;
          margin-bottom: 2px;
        }
        .header-sub {
          font-size: 10px;
          text-align: center;
          color: #444;
          margin-bottom: 6px;
        }
        .os-badge {
          background: #000;
          color: #fff;
          font-size: 14px;
          font-weight: bold;
          text-align: center;
          padding: 4px;
          border-radius: 4px;
          margin: 6px 0;
        }
        .info-row {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          margin: 3px 0;
        }
        .divider {
          border-bottom: 1px dashed #666;
          margin: 6px 0;
        }
        .total-box {
          background: #f4f4f4;
          border: 1px solid #ccc;
          padding: 6px;
          border-radius: 4px;
          margin-top: 6px;
          font-size: 13px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        
        <!-- VIA 1: CLIENTE -->
        <div class="via-card">
          <div style="font-size: 10px; font-weight: bold; text-align: center; color: #666; text-transform: uppercase;">✂️ [ 1ª VIA - CLIENTE ]</div>
          <div class="header-title">SAPATARIA CALCE COURO</div>
          <div class="header-sub">Av. Prestes Maia, 651 | Tel: (18) 3304-6049</div>
          <div class="os-badge">PEDIDO #${os.numero_os}</div>
          <div class="info-row"><span>Cliente:</span> <strong>${os.cliente_nome}</strong></div>
          <div class="info-row"><span>Telefone:</span> <span>${os.cliente_whatsapp}</span></div>
          <div class="info-row"><span>Entrada:</span> <span>${dataEntradaFmt}</span></div>
          <div class="info-row" style="color: #c00;"><span>Retirar em:</span> <strong>${dataPrevFmt}</strong></div>
          <div class="divider"></div>
          <div><strong>Serviços:</strong></div>
          ${itensHtml}
          ${obsHtml}
          <div class="total-box">
            <div class="info-row"><span>Total:</span> <strong>R$ ${os.valor_total.toFixed(2).replace('.', ',')}</strong></div>
            <div class="info-row"><span>Entrada:</span> <span>R$ ${os.valor_entrada.toFixed(2).replace('.', ',')}</span></div>
            <div class="info-row" style="font-size: 14px; color: #c00;"><span>A PAGAR:</span> <strong>R$ ${os.valor_restante.toFixed(2).replace('.', ',')}</strong></div>
          </div>
          <div style="font-size: 9px; text-align: center; margin-top: 8px; color: #555;">
            Apresente esta via para retirar seu calçado.
          </div>
        </div>

        <!-- VIA 2: SAPATO / OFICINA -->
        <div class="via-card">
          <div style="font-size: 10px; font-weight: bold; text-align: center; color: #666; text-transform: uppercase;">✂️ [ 2ª VIA - PRENDER NO SAPATO ]</div>
          <div class="header-title">SAPATARIA CALCE COURO</div>
          <div class="header-sub">Via da Oficina / Bancada</div>
          <div class="os-badge" style="font-size: 18px;">PEDIDO #${os.numero_os}</div>
          <div class="info-row"><span>Cliente:</span> <strong>${os.cliente_nome}</strong></div>
          <div class="info-row"><span>Telefone:</span> <span>${os.cliente_whatsapp}</span></div>
          <div class="info-row" style="font-size: 13px; color: #c00;"><span>ENTREGA:</span> <strong>${dataPrevFmt}</strong></div>
          <div class="divider"></div>
          <div><strong>Serviços a Executar:</strong></div>
          ${itensHtml}
          ${obsHtml}
          <div class="total-box">
            <div class="info-row"><span>Valor a Receber:</span> <strong>R$ ${os.valor_restante.toFixed(2).replace('.', ',')}</strong></div>
          </div>
          <div style="font-size: 9px; text-align: center; margin-top: 8px; color: #555;">
            Prender dentro do sapato ou na sacola do cliente.
          </div>
        </div>

      </div>
    </body>
    </html>
  `);
  doc.close();

  iframe.contentWindow.focus();
  setTimeout(() => {
    iframe.contentWindow.print();
    setTimeout(() => document.body.removeChild(iframe), 1500);
  }, 250);
}

// Impressão RawBT
function imprimirNoRawBT() {
  const os = app.ordemParaImprimir;
  if (!os) return;

  const [anoP, mesP, diaP] = (os.previsao_retirada_data || '2026-01-01').split('-');
  const dataPrevFmt = `${diaP}/${mesP}/${anoP} ${os.previsao_retirada_hora || '17:00'}`;
  const dataEntradaFmt = new Date(os.data_entrada).toLocaleString('pt-BR');

  let t = "";
  t += "     SAPATARIA CALCE COURO     \n";
  t += "   Consertos e Restauracoes   \n";
  t += "     Calcados e Bolsas         \n";
  t += "  Av. Prestes Maia, n 651     \n";
  t += "  Tel: (18) 3304-6049         \n";
  t += "  Whats: (18) 99753-2876      \n";
  t += "================================\n";
  t += `         PEDIDO #${os.numero_os}        \n`;
  t += "================================\n";
  t += `Entrada: ${dataEntradaFmt}\n`;
  t += `Retirar: ${dataPrevFmt}\n`;
  t += `Cliente: ${os.cliente_nome.slice(0, 23)}\n`;
  t += `Tel: ${os.cliente_whatsapp}\n`;
  t += "--------------------------------\n";
  t += "SERVICO                    VALOR\n";
  t += "--------------------------------\n";

  (os.itens || []).forEach(it => {
    t += `${it.nome.slice(0, 32)}\n`;
    const vStr = `R$ ${it.valor.toFixed(2).replace('.', ',')}`;
    const sStr = it.servico.slice(0, 20);
    const sp = " ".repeat(Math.max(1, 32 - sStr.length - vStr.length));
    t += `${sStr}${sp}${vStr}\n`;
  });

  t += "--------------------------------\n";
  const totStr = `R$ ${os.valor_total.toFixed(2).replace('.', ',')}`;
  t += `TOTAL:${" ".repeat(Math.max(1, 26 - totStr.length))}${totStr}\n`;

  const entStr = `R$ ${os.valor_entrada.toFixed(2).replace('.', ',')}`;
  t += `ENTRADA:${" ".repeat(Math.max(1, 24 - entStr.length))}${entStr}\n`;

  const restStr = `R$ ${os.valor_restante.toFixed(2).replace('.', ',')}`;
  t += `A PAGAR:${" ".repeat(Math.max(1, 24 - restStr.length))}${restStr}\n`;
  t += "================================\n";

  if (os.observacoes) {
    t += `OBS: ${os.observacoes}\n`;
    t += "--------------------------------\n";
  }

  t += "Obrigado pela confianca!\n";
  t += "Apresente este papel p/ retirar.\n";
  t += "Apos 90 dias calcados poderao\nser doados.\n\n\n\n";

  const b64 = btoa(unescape(encodeURIComponent(t)));
  window.location.href = `rawbt:base64,${b64}`;

  setTimeout(() => {
    if (confirm('Deseja abrir a janela normal de impressão?')) {
      window.print();
    }
  }, 1200);
}

// ==================================================
// FOTO GRANDE & CAIXA
// ==================================================
function abrirFotoGrande(src) {
  document.getElementById('imgFotoGrande').src = src;
  document.getElementById('modalFotoGrande').classList.add('open');
}

function fecharModalFoto() {
  document.getElementById('modalFotoGrande').classList.remove('open');
}

function abrirModalCaixa() {
  atualizarContadoresAbas();
  document.getElementById('modalCaixa').classList.add('open');
}

function fecharModalCaixa() {
  document.getElementById('modalCaixa').classList.remove('open');
}


// ==================================================
// SINCRONIZAÇÃO EM TEMPO REAL (ZERO F5)
// ==================================================
function configurarSyncRealtime() {
  const btnSyncCloud = document.getElementById('btnSyncCloud');
  const syncDot = document.getElementById('syncDot');
  const syncLabel = document.getElementById('syncStatusLabel');
  const syncPill = document.getElementById('btnSyncCloud');

  // Inicia motor de Tempo Real Instantâneo (SSE + BroadcastChannel + Cloud)
  RealtimeSync.init();

  // Quando qualquer aparelho mudar algo, a tela atualiza na hora sem recarregar!
  RealtimeSync.onDataChange(async (reason, data) => {
    await carregarOrdens();
    if (reason === 'order_saved') {
      tocarSomSucesso();
    }
  });

  // Monitor de Status de Sincronização
  RealtimeSync.onStatusChange((status, details) => {
    if (!syncDot || !syncLabel || !syncPill) return;

    if (status === 'syncing') {
      syncPill.classList.add('is-syncing');
      syncDot.className = 'sync-dot syncing';
      syncLabel.textContent = 'Sincronizando...';
    } else if (status === 'synced') {
      syncPill.classList.remove('is-syncing');
      syncDot.className = 'sync-dot pulse-green';
      const agora = new Date();
      const horaStr = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
      syncLabel.textContent = `Ao Vivo • OK ${horaStr}`;
    } else if (status === 'offline') {
      syncPill.classList.remove('is-syncing');
      syncDot.className = 'sync-dot offline';
      syncLabel.textContent = 'Salvo no Aparelho (Offline)';
    }
  });

  // Botão manual de Sincronizar Tudo
  async function dispararSincronizacaoManual() {
    if (syncLabel) syncLabel.textContent = 'Atualizando...';
    try {
      await RealtimeSync.syncAll();
      await carregarOrdens();
      tocarSomSucesso();
    } catch (e) {
      alert('Aviso de conexão: Os dados estão salvos no aparelho e serão sincronizados automaticamente.');
    }
  }

  if (btnSyncCloud) btnSyncCloud.addEventListener('click', dispararSincronizacaoManual);
}

window.abrirNovoConserto = abrirNovoConserto;
window.fecharModalConserto = fecharModalConserto;
window.abrirModalCaixa = abrirModalCaixa;
window.fecharModalCaixa = fecharModalCaixa;
window.fecharModalCupom = fecharModalCupom;
window.fecharModalFoto = fecharModalFoto;

// Toast de Notificacao Flutuante (Estilo TaskFlow)
function mostrarNotificacaoToast(msg, icone = 'fa-cloud-arrow-down', cor = '#10b981') {
  const toast = document.getElementById('syncToast');
  const txt = document.getElementById('syncToastText');
  const ico = document.getElementById('syncToastIcon');
  if (!toast || !txt) return;

  txt.textContent = msg;
  if (ico) {
    ico.className = 'fa-solid ' + icone;
    ico.style.color = cor;
  }
  toast.classList.add('show');
  if (window.toastTimer) clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

window.mostrarNotificacaoToast = mostrarNotificacaoToast;
window.tocarSomSucesso = tocarSomSucesso;


// ==================================================
// SISTEMA DE PROTECAO & CONTAS (OFICINA DOS PAIS & ADMINISTRADOR)
// ==================================================
let perfilAuthSelecionado = 'pais';

function verificarAutenticacaoInicial() {
  const authSalvo = localStorage.getItem('calce_auth_user') || sessionStorage.getItem('calce_auth_user');
  if (authSalvo) {
    try {
      const u = JSON.parse(authSalvo);
      aplicarContaConectada(u);
      const overlay = document.getElementById('authOverlay');
      if (overlay) overlay.style.display = 'none';
      return true;
    } catch(e) {}
  }
  const overlay = document.getElementById('authOverlay');
  if (overlay) overlay.style.display = 'flex';
  selecionarPerfilAuth('pais');
  setTimeout(() => {
    const input = document.getElementById('inputAuthPin');
    if (input) input.focus();
  }, 200);
  return false;
}

function selecionarPerfilAuth(perfil) {
  perfilAuthSelecionado = perfil;
  const btnPais = document.getElementById('btnPerfilPais');
  const btnAdmin = document.getElementById('btnPerfilAdmin');
  const labelPin = document.getElementById('labelAuthPin');
  const hint = document.getElementById('authHintText');
  const err = document.getElementById('authErrorMsg');
  const inputPin = document.getElementById('inputAuthPin');

  if (err) err.style.display = 'none';
  if (inputPin) {
    inputPin.value = '';
    inputPin.focus();
  }

  if (perfil === 'pais') {
    if (btnPais) btnPais.classList.add('active');
    if (btnAdmin) btnAdmin.classList.remove('active');
    if (labelPin) labelPin.textContent = 'Digite o PIN da Oficina (4 digitos):';
    if (hint) hint.innerHTML = '💡 PIN padrao da Oficina: <strong>6049</strong> (ou 1234)';
    if (inputPin) inputPin.setAttribute('inputmode', 'numeric');
  } else {
    if (btnAdmin) btnAdmin.classList.add('active');
    if (btnPais) btnPais.classList.remove('active');
    if (labelPin) labelPin.textContent = 'Senha / PIN do Administrador:';
    if (hint) hint.innerHTML = '👑 Senha padrao do Administrador: <strong>admin</strong> (ou 9975)';
    if (inputPin) inputPin.setAttribute('inputmode', 'text');
  }
}

function toggleVisibilidadePin() {
  const input = document.getElementById('inputAuthPin');
  const icon = document.getElementById('eyeIconPin');
  if (!input || !icon) return;
  if (input.type === 'password') {
    input.type = 'text';
    icon.className = 'fa-solid fa-eye-slash';
  } else {
    input.type = 'password';
    icon.className = 'fa-solid fa-eye';
  }
}

function executarLogin() {
  const inputPin = document.getElementById('inputAuthPin');
  const err = document.getElementById('authErrorMsg');
  const lembrar = document.getElementById('chkLembrarAcesso') ? document.getElementById('chkLembrarAcesso').checked : true;
  const pinDigitado = (inputPin ? inputPin.value : '').trim().toLowerCase();

  let autorizado = false;
  let nomeExibicao = '';

  if (perfilAuthSelecionado === 'pais') {
    const pinCustom = localStorage.getItem('calce_pin_pais');
    if (pinDigitado === '6049' || pinDigitado === '1234' || (pinCustom && pinDigitado === pinCustom)) {
      autorizado = true;
      nomeExibicao = 'Oficina (Pais)';
    }
  } else {
    const pinCustom = localStorage.getItem('calce_pin_admin');
    if (pinDigitado === 'admin' || pinDigitado === '9975' || pinDigitado === 'admin2026' || (pinCustom && pinDigitado === pinCustom)) {
      autorizado = true;
      nomeExibicao = 'Administrador';
    }
  }

  if (!autorizado) {
    if (err) {
      err.textContent = perfilAuthSelecionado === 'pais' ? 'PIN incorreto. Tente 6049.' : 'Senha incorreta. Tente admin.';
      err.style.display = 'block';
    }
    if (inputPin) {
      inputPin.select();
      inputPin.focus();
    }
    return;
  }

  const dadosUsuario = {
    perfil: perfilAuthSelecionado,
    nome: nomeExibicao,
    login_em: new Date().toISOString()
  };

  if (lembrar) {
    localStorage.setItem('calce_auth_user', JSON.stringify(dadosUsuario));
  } else {
    sessionStorage.setItem('calce_auth_user', JSON.stringify(dadosUsuario));
  }

  aplicarContaConectada(dadosUsuario);
  const overlay = document.getElementById('authOverlay');
  if (overlay) overlay.style.display = 'none';

  if (window.tocarSomSucesso) tocarSomSucesso();
  if (window.mostrarNotificacaoToast) {
    mostrarNotificacaoToast('Bem-vindo, ' + nomeExibicao + '!', 'fa-circle-check', '#10b981');
  }
}

function aplicarContaConectada(u) {
  localStorage.setItem('calce_operador_nome', u.nome || (u.perfil === 'admin' ? 'Administrador' : 'Oficina (Pais)'));

  const iconH = document.getElementById('headerPerfilIcon');
  const labelH = document.getElementById('labelNomeOperador');
  const badgeM = document.getElementById('perfilRoleBadge');
  const descM = document.getElementById('perfilDescricao');

  if (u.perfil === 'admin') {
    if (iconH) iconH.textContent = '👑';
    if (labelH) labelH.textContent = 'Admin';
    if (badgeM) badgeM.textContent = '👑 Administrador';
    if (descM) descM.textContent = 'Acesso administrativo completo: supervisao, ajuda e atualizacoes.';
  } else {
    if (iconH) iconH.textContent = '🛠️';
    if (labelH) labelH.textContent = 'Oficina';
    if (badgeM) badgeM.textContent = '🛠️ Oficina & Balcão';
    if (descM) descM.textContent = 'Acesso operacional da oficina dos pais para registrar consertos e entregas.';
  }
}

function abrirModalPerfil() {
  const modal = document.getElementById('modalPerfilUsuario');
  if (modal) modal.classList.add('open');
}

function fecharModalPerfil(e) {
  const modal = document.getElementById('modalPerfilUsuario');
  if (modal) modal.classList.remove('open');
}

function fazerLogout() {
  if (confirm('Deseja realmente sair e trocar de conta neste aparelho?')) {
    localStorage.removeItem('calce_auth_user');
    sessionStorage.removeItem('calce_auth_user');
    fecharModalPerfil();
    verificarAutenticacaoInicial();
  }
}

window.selecionarPerfilAuth = selecionarPerfilAuth;
window.toggleVisibilidadePin = toggleVisibilidadePin;
window.executarLogin = executarLogin;
window.abrirModalPerfil = abrirModalPerfil;
window.fecharModalPerfil = fecharModalPerfil;
window.fazerLogout = fazerLogout;
