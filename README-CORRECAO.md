# Financeiro v5.1.1 — correção dos Tesouros

Substitua somente:

- `schema.sql`
- `server.js`
- `public/index.html`

## Correções

1. O modal de `Guardar dinheiro` agora preenche automaticamente o dia:
   - dia de hoje no mês atual;
   - dia 1 em outro mês.

2. O sistema mostra mensagem clara quando faltar:
   - valor;
   - dia;
   - destino;
   - taxa contratada do Tesouro.

3. Ficam disponíveis somente:
   - Reserva de emergência;
   - Tesouro Prefixado 2029;
   - Tesouro Prefixado 2032.

4. A antiga conta genérica `Investimentos` é desativada.

Para preservar o histórico, eventual saldo inicial e lançamentos antigos da conta `Investimentos` são migrados para `Reserva de emergência`.

5. Tesouro Prefixado continua registrando a taxa por lote:
   - 2029: padrão inicial 14,95% a.a., vencimento 01/01/2029;
   - 2032: padrão inicial 15,48% a.a., vencimento 01/01/2032.

Não apague o PostgreSQL.
