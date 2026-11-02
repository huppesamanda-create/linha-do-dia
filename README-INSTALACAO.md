# Financeiro v5.1 — Investimentos

## Arquivos para substituir no GitHub

Somente:

- `schema.sql`
- `server.js`
- `public/index.html`

Não apague o PostgreSQL e não altere `DATABASE_URL`.

## Novos destinos do botão Guardar

- Reserva de emergência
- Tesouro Prefixado 2029
- Tesouro Prefixado 2032

### Tesouro Prefixado 2029
- taxa padrão inicial: 14,95% a.a.
- vencimento: 01/01/2029

### Tesouro Prefixado 2032
- taxa padrão inicial: 15,48% a.a.
- vencimento: 01/01/2032

Cada aporte em Tesouro registra sua própria taxa contratada.

## Visualização

A página passa a separar:

- total aportado;
- posição atual / marcação a mercado;
- valor bruto projetado no vencimento;
- ganho contratado futuro;
- lotes de cada compra;
- evolução das posições informadas.

Use **Atualizar posição** para lançar o valor que aparece no banco/corretora.

## Dados anteriores

A migração é aditiva. Nenhum lançamento antigo é apagado.

Se já existir uma conta antiga chamada `Investimentos`, ela continua visível como conta anterior/legado. Novos aportes pelo botão Guardar priorizam os três destinos acima.
