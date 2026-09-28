export type ProcessScope = 'own' | 'housing_complex' | 'all'

export type ProfilePermissions = {
  process: {
    /** Criar novo processo */
    create: boolean
    /** Ver processos que o próprio usuário criou */
    viewOwn: boolean
    /** Editar processos que o próprio usuário criou */
    editOwn: boolean
    /** Editar qualquer processo visível no escopo */
    editAny: boolean
    /** Iniciar processo jurídico (DOCUMENTACAO_PRONTA → EM_PROCESSO) */
    startLegal: boolean
    /** Editar dados jurídicos (número, valor de causa, protocolo) */
    editLegal: boolean
    /** Finalizar processo (EM_PROCESSO → FINALIZADO) */
    finalize: boolean
    /** Cancelar processos que o próprio usuário criou */
    cancelOwn: boolean
    /** Cancelar qualquer processo visível no escopo */
    cancelAny: boolean
    /** Marcar documentação como pronta manualmente */
    markDocumentationReady: boolean
    /** Enviar e organizar arquivos nos itens do checklist */
    uploadChecklist: boolean
    /** Excluir arquivos dos itens do checklist */
    deleteChecklistFile: boolean
    /** Ver arquivos enviados em lote */
    viewBatch: boolean
    /** Enviar arquivos em lote */
    uploadBatch: boolean
    /** Excluir arquivos do lote */
    deleteBatch: boolean
    /** Gerar PDF do processo */
    generatePdf: boolean
  }
  sections: {
    /** Acessar a página de dashboard */
    dashboard: boolean
    /** Ver aba de checklist (status consolidado da documentação) */
    checklist: boolean
    /** Ver aba de documentação (organização dos itens do checklist) */
    documentation: boolean
    /** Ver seção de dados jurídicos */
    legalData: boolean
    /** Ver histórico de movimentações do processo */
    history: boolean
    /** Ver aba de lote (arquivos brutos) */
    batch: boolean
  }
  titularCaixa: {
    /** Acessar a tela de titulares Caixa (lista, termos e aba do dashboard) */
    view: boolean
    /** Exportar a planilha de titulares */
    export: boolean
    /** Importar a planilha de titulares */
    import: boolean
    /** Reenfileirar a consulta de quitação */
    reconsultar: boolean
  }
  cadastros: {
    /** Aba Usuários: listar, criar, editar e resetar usuários (não-admin) */
    usuarios: boolean
    /** Aba Conjuntos: gerenciar conjuntos habitacionais e seus documentos */
    conjuntos: boolean
    /** Aba Permissões: perfis de permissão e atribuição a usuários */
    permissoes: boolean
  }
  /**
   * Módulo Pagamentos. NEGADO por padrão a todos, inclusive admin comum (vem do
   * perfil); somente MASTER tem tudo. Leitura respeita o escopo de processos.
   */
  financeiro: {
    /** Ver valores, recebimentos, prévias, fechamentos e extratos (no escopo) */
    view: boolean
    /** Registrar/editar recebimentos e anexar comprovantes */
    lancar: boolean
    /** Conferir recebimentos (apto a fechamento) */
    conferir: boolean
    /** Fechar em lote e estornar fechamentos (exige escopo total) */
    fechar: boolean
    /** Registrar/estornar baixas de pagamentos feitos fora (exige escopo total) */
    baixar: boolean
    /** Destinatários e regras de participação (exige escopo total) */
    regras: boolean
    /** Movimentar reservas e provisões (exige escopo total) */
    reservas: boolean
    /** Exportar extratos e demonstrativos */
    exportar: boolean
  }
}

export type ResolvedPermissions = {
  isAdmin: boolean
  /**
   * Administrador MASTER (role admin + CPF em MASTER_ADMIN_CPFS): único com
   * bypass total. Admins comuns recebem titulares Caixa via perfil.
   */
  isMaster: boolean
  processScope: ProcessScope
  /** IDs dos conjuntos habitacionais acessíveis (union: perfil + usuário individual) */
  allowedHousingComplexIds: string[]
  /** UFs liberadas ao usuário para Titular Caixa (grant geográfico, aditivo aos conjuntos) */
  allowedUfs: string[]
  /** Municípios liberados (par uf+município) para Titular Caixa */
  allowedMunicipios: Array<{ uf: string; municipio: string }>
  permissions: ProfilePermissions
  profileId: string | null
  profileName: string | null
}

/** Relação do usuário com um processo específico */
export type ProcessRelationship = {
  /** Usuário criou este processo */
  isCreator: boolean
  /** Usuário foi designado como responsável pela documentação deste processo */
  isDocumentationAssignee: boolean
  /** Processo está no escopo de visibilidade geral do usuário */
  isInScope: boolean
}
