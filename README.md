# Linha do Dia

Projeto mínimo para substituir o antigo Segundo Cérebro.

## Arquivos

- `package.json`
- `server.js`
- `public/index.html`
- `.gitignore`

## Instalação no GitHub

1. Apague os arquivos antigos do repositório.
2. Envie para a raiz do repositório exatamente os arquivos e a pasta deste pacote.
3. A estrutura final deve ficar assim:

```text
/
├── .gitignore
├── package.json
├── server.js
└── public/
    └── index.html
```

## Railway

O Railway deve detectar Node automaticamente.

Comando de start:

```text
npm start
```

Não é necessário banco de dados nem variável de ambiente.

## Persistência

Os registros ficam salvos no `localStorage` do navegador.

Isso significa:
- atualizar a página não apaga os dados;
- fechar e abrir o navegador não apaga os dados;
- um cronômetro ativo continua depois de recarregar a página;
- os dados pertencem ao navegador/dispositivo em que foram criados.

Se você limpar os dados do navegador ou abrir o site em outro dispositivo, os registros não estarão lá.
