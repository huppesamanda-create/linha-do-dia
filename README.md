# Financeiro v5.0

A aplicação agora mantém somente o módulo financeiro.

## Permanece
- fluxo de caixa anual;
- lançamentos realizados e provisionados;
- simulação diretamente nas células;
- categorias e orçamentos;
- detalhamento das categorias;
- recorrências programadas;
- reservas e investimentos;
- edição e exclusão de lançamentos.

## Removido da interface
- cronômetro / Linha do Dia;
- planejamento;
- Strikes;
- ENAM;
- Google Calendar;
- Google Tasks.

## Página
`/` abre diretamente o Financeiro.

Os endereços antigos `/financeiro/` e `/enam/` redirecionam para `/`.

## Instalação
A forma mais limpa é substituir todo o conteúdo atual do repositório pelo conteúdo deste ZIP.

Mantenha:
- o serviço PostgreSQL no Railway;
- a variável `DATABASE_URL`.

Não apague o banco.

As antigas tabelas de módulos que deixaram de existir podem continuar no PostgreSQL. Elas foram mantidas para evitar exclusão destrutiva de dados, mas não aparecem mais na aplicação.
