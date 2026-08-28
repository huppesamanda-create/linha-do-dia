# Linha do Dia v4 — versão estável reescrita

Esta versão foi reescrita do zero e usa tabelas novas no PostgreSQL:

- `ld4_activities`
- `ld4_plans`

Ela não depende das tabelas criadas pelas versões anteriores.

## Recursos

- cronômetro;
- tempo visível no título da aba;
- modo foco quando há atividade em andamento;
- descrição e anotações;
- anotações salvas automaticamente;
- checklist;
- linha do tempo em ordem cronológica;
- edição de registros pelo botão `···`;
- reabrir atividade concluída;
- lançamento manual;
- planejamento de amanhã;
- iniciar atividade planejada;
- exportar PDF do dia.

## Instalação

Substitua TODO o conteúdo do repositório pelos arquivos deste pacote.

Estrutura:

```text
/
├── .gitignore
├── package.json
├── db.js
├── schema.sql
├── server.js
└── public/
    └── index.html
```

No Railway, mantenha apenas:

1. o serviço Node conectado ao GitHub;
2. o PostgreSQL;
3. `DATABASE_URL` no serviço Node apontando para o Postgres.

Não é preciso executar SQL manualmente. As tabelas novas são criadas automaticamente.
