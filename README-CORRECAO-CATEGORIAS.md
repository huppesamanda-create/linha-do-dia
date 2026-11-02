# Financeiro v6.0.1 — exclusão de categorias

Substitua somente:

- `server.js`
- `public/index.html`

Não é necessário substituir `schema.sql`.

## Como funciona

No gerenciador de categorias (`···`), cada categoria agora possui:

- `✓` para salvar nome/orçamento;
- `×` para excluir.

Ao excluir:

- a categoria some dos novos lançamentos;
- a categoria some dos orçamentos ativos;
- recorrências ligadas a ela são desativadas;
- lançamentos antigos NÃO são apagados;
- o nome da categoria continua aparecendo no histórico.

A exclusão é independente entre PF e PJ.
