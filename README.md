# Linha do Dia — PostgreSQL

Esta é a versão persistente da Linha do Dia.

## Estrutura

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

## Railway

1. Crie/deploy a aplicação a partir do repositório GitHub.
2. No mesmo projeto Railway, clique em `+ New`.
3. Selecione `Database` → `PostgreSQL`.
4. Abra o serviço da aplicação.
5. Vá em `Variables`.
6. Adicione uma Reference Variable chamada `DATABASE_URL`, apontando para `Postgres.DATABASE_URL`.
7. Aplique/deploy as alterações.

Não é necessário expor o PostgreSQL publicamente.

Na primeira inicialização, o servidor cria a tabela automaticamente a partir do `schema.sql`.

## Persistência

Atividades, horários, duração, estado do cronômetro e checklists ficam no PostgreSQL.
Você pode atualizar a página ou abrir o site em outro navegador/dispositivo e continuar vendo os dados do banco.
