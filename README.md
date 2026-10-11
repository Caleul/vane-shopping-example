# Compras com Vane

Serviço de exemplo que salva carrinhos e encontra o mercado com o menor preço
para comprar todos os itens. Usa Vane e PostgreSQL, com uma API HTTP em Node.js.

O usuário cadastra mercados, produtos e os preços de cada mercado. Depois salva
um carrinho com produtos e quantidades, compara os totais e registra uma compra.
O registro guarda os produtos, as quantidades e os preços daquele momento.

## Executar

Requisitos: Node.js **24.19.0** e Docker Compose, ou PostgreSQL **16** já disponível.

```sh
npm ci --ignore-scripts
cp .env.example .env
docker compose up -d --wait
npm run migrate
npm start
```

Em outro terminal:

```sh
npm run demo
```

A demonstração cria os cadastros, salva um carrinho e registra uma compra.
Para dois pacotes de arroz e um de feijão, ela mostra:

```text
Mercado B: R$ 15,00
Mercado A: R$ 18,00
Mais barato: Mercado B
Compra registrada: <id> — R$ 15,00
```

É possível repetir a demonstração: cada execução cria novos produtos com SKUs
próprios. Os mercados de execuções anteriores não oferecem esses produtos e
aparecem como incompletos para o novo carrinho.

O serviço escuta em `http://127.0.0.1:3000`. Para outro PostgreSQL, configure
`DATABASE_URL` no `.env`. `VANE_NAMESPACE` escolhe o schema e `PORT` escolhe a porta.
`docker compose stop` preserva os dados no volume.

## Regras de comparação e compra

- Um produto representa o mesmo SKU e a mesma embalagem em todos os mercados.
  Por exemplo, arroz de uma marca em pacote de 1 kg.
- Preços são inteiros em centavos; quantidades são inteiros positivos.
  `500` representa R$ 5,00. A quantidade multiplica o preço unitário.
  O exemplo aceita até 100 produtos por carrinho, quantidade até 1.000 e preço
  unitário até 100.000.000 centavos. O total registrado cabe no `integer` do
  PostgreSQL: até 2.147.483.647 centavos.
- O ranking compara o carrinho inteiro em **um único mercado**. Não divide a
  compra entre mercados. Um mercado sem preço para qualquer item fica fora do
  ranking, com a lista dos produtos ausentes.
- Em empate, o UUID do mercado define a ordem. Um carrinho vazio pode ser salvo,
  mas precisa de produtos para comparar ou comprar.
- A comparação reflete os preços atuais. A compra recalcula os preços ao ser
  registrada e, por padrão, escolhe o mercado mais barato. Também é possível
  escolher explicitamente outro mercado que ofereça todos os itens.
- A compra mantém uma fotografia dos preços e nomes. Mudanças posteriores no
  catálogo ou carrinho não alteram esse registro. O carrinho continua salvo e
  pode ser reutilizado.
- `Idempotency-Key`, quando informado, deve ser um UUID. Repetir a compra com a
  mesma chave retorna o registro original; usar a chave para outro carrinho ou
  mercado retorna conflito. Sem a chave, cada requisição registra uma nova compra.

## API

POST e PUT recebem JSON. IDs são gerados pelo serviço.

| Método | Rota | Corpo / resultado |
| --- | --- | --- |
| GET | `/health` | Estado do serviço |
| POST | `/api/users` | `{ "name": "Ana" }` |
| GET | `/api/users` | Lista usuários |
| POST | `/api/markets` | `{ "name": "Mercado A" }` |
| GET | `/api/markets` | Lista mercados |
| POST | `/api/products` | `{ "sku": "arroz-1kg", "name": "Arroz", "unit": "pacote 1 kg" }` |
| GET | `/api/products` | Lista produtos |
| PUT | `/api/markets/:marketId/products/:productId` | `{ "priceCents": 500 }`; cria ou atualiza um preço |
| GET | `/api/markets/:marketId/products` | Produtos e preços do mercado |
| POST | `/api/carts` | `{ "userId": "<uuid>", "name": "Semana", "items": [{ "productId": "<uuid>", "quantity": 2 }] }` |
| GET | `/api/carts?userId=:userId` | Carrinhos salvos do usuário |
| GET | `/api/carts/:cartId` | Um carrinho |
| PUT | `/api/carts/:cartId` | `{ "items": [...] }`; substitui os itens, com `name` opcional |
| GET | `/api/carts/:cartId/quote` | Mercado mais barato, ranking e mercados incompletos |
| POST | `/api/carts/:cartId/purchase` | `{}` para o mais barato; `{ "marketId": "<uuid>" }` para escolher |
| GET | `/api/purchases?userId=:userId` | Histórico de compras do usuário |
| GET | `/api/purchases/:purchaseId` | Compra e fotografia dos preços |

Exemplo de compra com proteção contra repetição:

```sh
curl -X POST http://127.0.0.1:3000/api/carts/<cartId>/purchase \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: <uuid-novo>' \
  -d '{}'
```

As respostas de criação retornam `201`. Consultas e atualizações retornam `200`.
Entrada inválida retorna `400`, cadastro ausente `404` e compra inviável ou
conflito `409`. O cliente não envia o total nem a fotografia da compra.

## Onde entra o Vane

- [`src/model.vane.ts`](src/model.vane.ts): entidades `User`, `Market`, `Product`,
  `Offer`, `Cart` e `Purchase`; eventos, views e sagas de um passo.
- [`src/configuration.mjs`](src/configuration.mjs): configuração do monólito e
  providers PostgreSQL para mailbox, outbox, deduplicação e sagas.
- [`src/vane.mjs`](src/vane.mjs): migração e execução dos contratos Vane. Cada
  alteração espera o terminal da saga antes de responder.
- [`src/app.mjs`](src/app.mjs): API de compras, validação e composição das views.
- [`src/pricing.mjs`](src/pricing.mjs): comparação de preços, sem acesso ao banco.

Todas as escritas de domínio passam por eventos Vane; a aplicação não escreve
SQL de domínio. A API usa os contratos configurados em processo e não expõe
eventos internos de compra que permitam enviar um total arbitrário.

## Dependência do release

A publicação do Vane foi adiada. Este exemplo usa o pacote validado
`@lilka/vane@0.1.0-rc.1` em [`vendor/`](vendor/), instalado por `file:`.
Não depende de uma versão publicada no npm nem de um checkout irmão.
O pacote contém a licença MIT do Vane.

[`vendor/provenance.json`](vendor/provenance.json) identifica o commit de origem
e o SHA-256. `npm run verify:vendor` verifica os bytes. O commit e os três gates
aprovados estão em [DEPENDENCIES.md](DEPENDENCIES.md).

Para fechar a fase 9 do Vane, o próximo passo continua sendo publicar o RC,
instalar e revisar o pacote obtido do registry e só então preparar e validar a
GA `0.1.0`. Quando isso ocorrer, trocar a dependência `file:` pela versão exata
publicada, atualizar o lockfile e executar os testes deste exemplo novamente.

## Validar

Com o PostgreSQL disponível e `.env` configurado:

```sh
npm run check
```

O comando verifica o pacote, os tipos e o build, e executa testes de comparação
e integração HTTP com Vane/PostgreSQL reais. A integração usa um schema temporário
próprio e o remove ao terminar; não modifica o schema `shopping`.
`npm run test:unit` executa somente os testes de comparação, sem banco.
O GitHub Actions executa a mesma validação com PostgreSQL 16.15.

## Limites do exemplo

Não inclui pagamento, estoque, entrega nem integração com mercados. “Comprar”
significa registrar a escolha e os valores no serviço; não envia um pedido ao
mercado. Os preços são cadastrados manualmente, sem garantia de disponibilidade.

É um exemplo local sem login: usuários são cadastros, não identidades autenticadas,
e qualquer cliente local pode consultar ou modificar os dados. A execução prevista
é um único processo, com requisições serializadas para manter comparação e compra
coerentes com as alterações desse processo. Antes de disponibilizar para usuários
reais, adicionar autenticação, autorização por usuário e concorrência entre instâncias.

A migração cobre o modelo inicial e sua reaplicação. Alterar o modelo requer um
plano de migração explícito com o IR anterior. Não há atualização automática de schema.
