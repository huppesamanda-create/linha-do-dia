# Financeiro v6.0 — PF / PJ

## Arquivos para substituir no GitHub

Substitua somente:

- `schema.sql`
- `server.js`
- `public/index.html`

Não apague o PostgreSQL e não altere `DATABASE_URL`.

## O que acontece com seus dados atuais

Todos os dados financeiros já existentes continuam como **PF**.

A nova aba **PJ** começa separada, sem lançamentos anteriores.

## Estrutura da PJ

Categorias iniciais:
- Contabilidade
- Softwares
- Marketing
- Estrutura
- Impostos e taxas
- Pró-labore
- Outros

Reservas iniciais:
- Reserva para impostos
- Reserva operacional

## Separação real

PF e PJ passam a ter separadamente:
- saldo inicial anual;
- lançamentos;
- categorias;
- orçamentos;
- recorrências;
- reservas;
- projeções.

A troca PF / PJ é feita no topo da página.

## PF

A área de investimentos continua com:
- Reserva de emergência
- Tesouro Prefixado 2029
- Tesouro Prefixado 2032

Nenhuma função da versão atual é removida.
