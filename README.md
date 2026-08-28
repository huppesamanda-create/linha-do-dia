# Linha do Dia v4.2 — ENAM + Financeiro

Pacote completo para substituir o conteúdo do repositório.

## Rotas

- `/` — Linha do Dia
- `/enam/` — Portal ENAM 2026.2
- `/financeiro/` — Fluxo de caixa anual

## Financeiro

- visão anual dos 12 meses com rolagem horizontal;
- colunas Data, Entrada, Saída, Diário e Saldo;
- lançamentos realizados e provisionados;
- categoria obrigatória para gastos;
- orçamento mensal por categoria;
- saldo real e saldo projetado;
- saldo inicial do ano editável;
- limite amarelo editável;
- simulação diretamente nas células de Saída/Diário;
- impacto da simulação recalculado do dia até dezembro;
- amarelo para saldo apertado e vermelho para saldo negativo;
- simulação pode ser descartada ou transformada em provisionado;
- edição e exclusão de lançamentos;
- dados persistidos no PostgreSQL.

## Instalação

Substitua todo o conteúdo do GitHub pelo conteúdo deste ZIP. Não exclua o PostgreSQL e não altere a `DATABASE_URL`.

O `schema.sql` cria automaticamente as novas tabelas financeiras sem apagar Linha do Dia ou ENAM.
