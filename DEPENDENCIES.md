# Dependências e próximos passos

O exemplo pode ser executado sem publicar o Vane. Usa um pacote local vendorizado,
com lockfile e hash verificáveis.

| Dependência | Estado |
| --- | --- |
| Vane `0.1.0-rc.1` | Tarball validado incluído em `vendor/`; não publicado |
| Origem | [`Caleul/vane`, commit `f7a9430`](https://github.com/Caleul/vane/commit/f7a943004a3816337ca4eb7f30b573e8cf4e54af) |
| CI Vane | [Aprovado](https://github.com/Caleul/vane/actions/runs/38102866124) |
| Consumidores externos Vane | [Aprovados](https://github.com/Caleul/vane/actions/runs/38102866132) |
| Release readiness Vane | [Aprovado](https://github.com/Caleul/vane/actions/runs/38102866163) |
| Runtime | Node.js 24.19.0 e PostgreSQL 16.15 |

SHA-256 do pacote:

```text
b467027e13687831b0f073b4bd07cf140063ae446cec7d9fc7a29bb4964fea29
```

## Sequência para concluir o release do Vane

1. Configurar e comprovar acesso ao npm (`NPM_TOKEN` ou trusted publishing).
2. Publicar o RC com o workflow revisado, verificando integridade e instalação
   a partir do registry. Essa execução foi adiada pelo usuário.
3. Revisar explicitamente API, documentação e segurança do RC publicado.
4. Preparar `0.1.0` e validar seu próprio tarball, upgrade e consumidores.
5. Publicar a GA e atualizar este exemplo para a versão exata do npm.

Os resultados do RC local não comprovam publicação e não substituem os gates
do futuro pacote GA. Nenhuma dessas publicações é necessária para executar
este exemplo hoje.
