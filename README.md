# Linha do Dia v3.1

Versão de correção da atualização v3.

## Correção de inicialização

A versão v3 tentava adicionar a coluna `notes` diretamente na tabela `activities`
durante a inicialização. Nesta versão isso foi removido.

As anotações agora ficam em uma tabela separada:

```text
activity_notes
```

Isso evita alterar a tabela que já contém seus registros.

O PDFKit também passou a ser carregado somente quando o botão de exportação de PDF é usado,
e não durante a inicialização da aplicação.

## O que permanece

- dados existentes preservados;
- descrição + anotações;
- anotações salvas no PostgreSQL;
- botão recolhido de anotações na linha do tempo;
- linha do tempo do mais antigo para o mais recente;
- exportação em PDF;
- checklist;
- cronômetro.

## Atualização

Substitua no GitHub:

- `package.json`
- `db.js`
- `schema.sql`
- `server.js`
- `public/index.html`

Não apague o PostgreSQL.

A `.gitignore` atual pode permanecer como está.
