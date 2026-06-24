/*
 * constants.js
 * ------------------------------------------------------------------
 * Constantes compartilhadas: tipos de mensagem, enums de status,
 * chave de armazenamento e configuracoes padrao.
 */
;(function () {
  const NS = (self.IRRF = self.IRRF || {});

  // Tipos de mensagem trocados entre UI <-> service worker <-> content.
  NS.MSG = {
    // UI -> service worker
    INICIAR: 'INICIAR',
    PAUSAR: 'PAUSAR',
    RETOMAR: 'RETOMAR',
    CANCELAR: 'CANCELAR',
    REINICIAR: 'REINICIAR',
    OBTER_ESTADO: 'OBTER_ESTADO',
    // service worker -> UI (broadcast)
    ESTADO_ATUALIZADO: 'ESTADO_ATUALIZADO',
    // service worker -> content script
    COLETAR: 'COLETAR',
    PING: 'PING',
  };

  // Status global da execucao.
  NS.STATUS = {
    OCIOSO: 'ocioso',
    EXECUTANDO: 'executando',
    PAUSADO: 'pausado',
    CONCLUIDO: 'concluido',
    CANCELADO: 'cancelado',
    ERRO: 'erro',
  };

  // Status de cada tarefa individual (combinacao CPF x competencia).
  NS.TAREFA = {
    PENDENTE: 'pendente',
    PROCESSANDO: 'processando',
    CONCLUIDA: 'concluida',
    SEM_REGISTRO: 'sem_registro',
    ERRO: 'erro',
  };

  // Chave unica usada em chrome.storage.local.
  NS.STORAGE_KEY = 'irrf_esocial_estado';

  // Configuracoes padrao (ajustaveis).
  NS.CONFIG = {
    // Pasta raiz (relativa a pasta de Downloads do navegador).
    PASTA_RAIZ: 'IRRF eSocial',
    // Ordem de varredura: 'cpf' = colaborador externo / competencia interna.
    //                     'competencia' = competencia externa / CPF interno.
    ORDEM: 'cpf',
    // Tentativas por tarefa antes de marcar erro definitivo.
    MAX_TENTATIVAS: 3,
    // Intervalo (ms) entre tarefas para nao sobrecarregar o portal.
    INTERVALO_TAREFAS_MS: 400,
    // Timeout (ms) de espera por elementos da pagina do eSocial.
    TIMEOUT_ELEMENTO_MS: 20000,
    // Nome do alarme usado para manter o service worker vivo / watchdog.
    ALARM_KEEPALIVE: 'irrf_keepalive',
  };
})();
