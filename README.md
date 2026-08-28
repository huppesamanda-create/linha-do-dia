# Linha do Dia v4.1 + Portal ENAM

Pacote completo com duas áreas:

- `/` → Linha do Dia
- `/enam/` → Portal ENAM 2026.2

A rota `/enam` redireciona automaticamente para `/enam/`.

## PostgreSQL

Esta versão usa:

- `ld4_activities`
- `ld4_plans`
- `ld4_enam_state`

O progresso do Portal ENAM é salvo em `ld4_enam_state` como JSONB.

## Instalação

Substitua TODO o conteúdo do repositório pelo conteúdo deste pacote.

Estrutura:

```text
/
├── .gitignore
├── package.json
├── db.js
├── schema.sql
├── server.js
└── public/
    ├── index.html
    └── enam/
        └── index.html
```

No Railway, mantenha:
1. o serviço Node conectado ao GitHub;
2. o PostgreSQL;
3. a `DATABASE_URL` da aplicação apontando para o PostgreSQL.

Não é necessário executar SQL manualmente.
