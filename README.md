# Finance Compass

Organizador de finanças pessoais **local-first** para desktop. Você importa os extratos do seu banco, classifica para onde o dinheiro foi, define orçamentos e acompanha tudo num painel — e os seus dados nunca saem do seu computador: ficam numa pasta sua, como arquivos JSON que você pode abrir, copiar e versionar.

> Versão 0.1.0, em desenvolvimento ativo. Feito e testado no Windows 11; a interface é em português e os valores são em reais (BRL).

## O que ele faz hoje

| Área | O que você consegue fazer |
| --- | --- |
| **Contas** | Conta corrente, poupança, dinheiro e cartão de crédito. Editar nome, tipo e saldo inicial; excluir uma conta sem lançamentos. O saldo atual é sempre *calculado* (saldo inicial + transações), nunca digitado. |
| **Importação OFX** | Importa o extrato exportado pelo banco. Lançamentos já importados são ignorados automaticamente (pelo identificador do banco), então reimportar um período sobreposto não duplica nada. Lida com bancos que declaram a codificação errada (ex.: Banco Inter) e avisa sobre lançamentos ilegíveis em vez de descartá-los em silêncio. |
| **Transações** | Lista completa com filtros (conta, mês, tipo, categoria, "sem categoria") e busca que ignora acentos e maiúsculas. Classificação em massa ("selecionar todas do filtro → classificar como…"), edição e exclusão. |
| **Transferências** | Marcar um lançamento importado (ex.: `APLICACAO CDB`) como transferência para outra conta sua, para que dinheiro guardado não conte como gasto — e desfazer, se errar. Dá para marcar uma seleção inteira de uma vez contra a mesma conta, dizendo antes quanto vai mexer em qual saldo. |
| **Regras** | Página própria: "descrição contém `IFOOD` → Restaurantes", testadas na ordem que você define, aplicadas na importação e, sob confirmação, ao que já está sem categoria. Nunca mudam uma categoria que você escolheu. Depois de classificar à mão, o app oferece guardar aquilo como regra. |
| **Categorias** | Página própria para criar, renomear e mover categorias entre grupos. Excluir só é permitido quando nada mais usa a categoria. Cofres novos já vêm com 43 categorias brasileiras em 14 grupos. |
| **Orçamentos** | Limite mensal por categoria de despesa, com medidor de "no limite / perto / acima". |
| **Painel** | Receitas, despesas e saldo do mês; gastos por categoria; receitas × despesas dos últimos 6 meses. Todo gráfico tem uma visão em tabela. |
| **Cofre** | Escolher outra pasta (pendrive, pasta sincronizada…), estilo Obsidian. Gravação atômica e aviso claro se algo não pôde ser salvo. |

**O que ele não faz, de propósito:** não se conecta ao seu banco, não envia nada para a internet e não tem conta/login. Veja [ADR-0004](docs/adr/0004-statement-import-not-live-aggregation.md).

---

## Usando o app

### 1. Instalar

Ainda não há um instalador publicado para download. Para gerar o seu, siga [Rodando do zero](#rodando-do-zero) até o passo de **instalador**; o `Finance Compass_0.1.0_x64-setup.exe` sai em `src-tauri/target/release/bundle/nsis/`. Dê dois cliques nele e o Finance Compass aparece no menu Iniciar. Instalar uma versão nova por cima mantém os seus dados — eles ficam no cofre, não na pasta do programa.

### 2. Primeiros passos

1. **Contas → Adicionar conta.** Dê um nome (ex.: "Banco Inter"), o tipo e o saldo que a conta tinha *antes* do primeiro lançamento que você vai importar.
2. **Exporte o extrato OFX** no app ou site do seu banco (geralmente em "Extrato → Exportar → OFX/Money").
3. **Contas → Importar extrato (OFX).** Escolha o arquivo. O app mostra quantos lançamentos são novos e quantos já existiam antes de você confirmar.
4. **Transações → classificar.** Os importados chegam *sem categoria*. Filtre por "Sem categoria", busque um estabelecimento (ex.: `uber`), marque "Selecionar todas" e escolha a categoria de uma vez. Depois disso o app oferece guardar aquilo como uma **regra** — aceite, e no mês que vem esses lançamentos já chegam classificados.
5. **Aplicações e resgates.** Se o banco lança dinheiro indo e voltando de investimento como gasto e receita, crie uma conta para o investimento (ex.: "Inter CDB", tipo Poupança) e use **transferência** na linha do lançamento. Isso tira esse dinheiro das despesas e o mostra na conta certa. Quando são centenas de lançamentos iguais, busque o texto que eles têm em comum (ex.: `aplicacao`), marque "Selecionar todas" e use a marcação em lote na barra verde: o app diz quanto vai mexer em qual saldo antes de você confirmar.
6. **Regras.** Uma regra classifica sozinha o que a descrição contém (`IFOOD` → Restaurantes), sem ligar para maiúsculas ou acentos. Elas são testadas de cima para baixo e a primeira que combina decide — suba uma regra específica acima de uma genérica. Regras só preenchem o que está *sem categoria*: nunca mudam uma categoria que você escolheu. O botão "Aplicar as regras ao que está sem categoria" diz quantas transações vai classificar antes de fazer.
7. **Orçamentos** para pôr limites por categoria, e **Painel** para acompanhar o mês.

Valores podem ser digitados como `1.234,56`, `12,50` ou `12.50` — todos são lidos como o esperado. Um formato ambíguo (ex.: `1,234.56`) é recusado em vez de adivinhado.

### 3. Onde ficam os seus dados

Por padrão, em:

```
%APPDATA%\com.rafaelpulzi.financecompass\vault\
```

| Arquivo | Conteúdo |
| --- | --- |
| `meta.json` | Versão do formato (hoje, 4). É o que marca a pasta como um cofre. |
| `accounts.json` | Contas e saldos iniciais. |
| `transactions.json` | Todas as transações. Valores em **centavos inteiros** (`4990` = R$ 49,90). |
| `groups.json`, `categories.json` | Grupos e categorias. |
| `rules.json` | Suas regras de classificação, na ordem em que são testadas. |
| `budgets.json` | Limites mensais. |
| `imports.json` | Histórico de importações. |
| `dismissed-transfers.json` | Sugestões de transferência que você recusou. |

- **Backup:** feche o app e copie a pasta inteira. Restaurar é copiar de volta.
- **Mudar de lugar:** na aba **Cofre**, "Escolher outra pasta…". Uma pasta vazia recebe o cofre atual; uma pasta que já tem um cofre é aberta.
- Cofres de versões antigas do app são lidos normalmente e atualizados só na primeira alteração que você fizer.

---

## Rodando do zero

### Pré-requisitos (Windows)

| Ferramenta | Versão usada | Como obter |
| --- | --- | --- |
| Node.js + npm | Node 24 | <https://nodejs.org> |
| Rust (toolchain MSVC) | stable (1.90+) | <https://rustup.rs> |
| Visual Studio Build Tools 2022 | carga "Desenvolvimento para desktop com C++" | <https://visualstudio.microsoft.com/visual-cpp-build-tools/> |
| WebView2 | já vem no Windows 11 | — |
| Git | qualquer recente | <https://git-scm.com> |

Depois de instalar o Rust, **feche e abra o terminal** — senão `cargo` não é encontrado. macOS e Linux também são suportados pelo Tauri, mas ainda não foram testados com este projeto; veja os [pré-requisitos do Tauri](https://v2.tauri.app/start/prerequisites/).

### Passo a passo

```powershell
git clone https://github.com/RafaelPulzi/finance-compass-local.git
cd finance-compass-local

# 1. Dependências (exatamente as do package-lock.json)
npm ci

# 2. Os quatro "gates" — os mesmos que o CI roda
npm test            # testes automatizados
npm run typecheck   # checagem de tipos TypeScript
npm run lint        # oxlint
npm run build       # build de produção da interface

# 3. Abrir o app desktop em modo de desenvolvimento (recarrega ao salvar o código)
npm run tauri dev

# 4. Gerar o instalador
npm run tauri build
```

Tempos medidos numa cópia limpa (Windows 11, 2026-11-07): `npm ci` ≈ 40 s, testes ≈ 30 s, typecheck + lint + build ≈ 10 s, instalador ≈ 4 min na primeira vez (o Rust compila tudo do zero; depois fica bem mais rápido). O instalador sai em dois formatos:

```
src-tauri/target/release/bundle/nsis/Finance Compass_0.1.0_x64-setup.exe   (≈ 2,3 MB)
src-tauri/target/release/bundle/msi/Finance Compass_0.1.0_x64_en-US.msi    (≈ 3,4 MB)
```

Como o instalador ainda não é assinado digitalmente, o Windows pode mostrar o aviso "O Windows protegeu o computador" — clique em "Mais informações → Executar assim mesmo".

Só quer mexer na interface? `npm run dev` abre em <http://localhost:1420> no navegador, sem o Rust. Nesse modo os dados ficam no `localStorage` do navegador — serve para desenvolver, não para uso real.

### Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Interface no navegador (Vite), dados no `localStorage`. |
| `npm run tauri dev` | App desktop com recarga automática. |
| `npm test` / `npm run test:watch` | Testes (Vitest), uma vez / observando mudanças. |
| `npm run typecheck` | `tsc` sem gerar arquivos. |
| `npm run lint` | oxlint. |
| `npm run build` | Build de produção da interface em `dist/`. |
| `npm run tauri build` | Instalador desktop em `src-tauri/target/release/bundle/`. |

---

## Como o código é organizado

```
src/
  domain/        regras de negócio puras (sem React, sem disco) — dinheiro, OFX,
                 importação, saldos, relatórios, categorias, contas, transferências, regras
  store/         estado da aplicação (Zustand); grava o cofre numa fila serializada
  persistence/   onde o cofre mora: arquivos JSON (desktop) ou localStorage (navegador)
  ui/            componentes React, uma pasta por tela
  integration/   teste de ponta a ponta de uma "jornada" completa de uso
src-tauri/       casca desktop (Rust/Tauri) e permissões de acesso a arquivos
docs/adr/        decisões de arquitetura e seus porquês
CONTEXT.md       glossário do domínio (Transação, Transferência, Cofre, …)
```

A regra de ouro: **toda regra mora em `src/domain`**, e a interface só pergunta e mostra o veredito. Por isso o formulário, o store e os testes nunca discordam sobre o que é uma transação válida.

Decisões importantes, em [`docs/adr/`](docs/adr/):

1. [Casca desktop com Tauri](docs/adr/0001-tauri-desktop-shell.md)
2. [Arquivos JSON legíveis como formato do cofre](docs/adr/0002-json-files-as-vault-format.md)
3. [Dinheiro em centavos inteiros](docs/adr/0003-money-as-integer-centavos.md)
4. [Importar extratos, não conectar ao banco](docs/adr/0004-statement-import-not-live-aggregation.md)
5. ["Sem categoria" é ausência, não uma categoria](docs/adr/0005-uncategorized-is-null.md)
6. [Transferências são recuperadas depois da importação](docs/adr/0006-transfers-recovered-after-import.md)
7. [Gravação atômica e falhas visíveis](docs/adr/0007-atomic-saves-and-visible-failures.md)

### Testes

A suíte tem mais de 1.100 testes, em camadas:

- **Domínio:** cada regra com exemplos, incluindo casos de borda (datas inexistentes, valores ambíguos, OFX com codificação mentirosa).
- **Invariantes:** 60 cofres gerados aleatoriamente (com semente fixa, reprodutíveis) verificando que nenhuma visão cria ou perde dinheiro — patrimônio = saldos iniciais + receitas − despesas; filtros particionam a lista; categorizado + sem categoria = despesa total; marcar e desfazer uma transferência restaura o lançamento.
- **Persistência:** o disco falso simula **queda de energia em cada passo** de uma gravação e confere que o cofre continua abrindo.
- **Store e interface:** cada tela com Testing Library.
- **Jornada:** importar um extrato estilo Banco Inter, reimportar, classificar, marcar aplicação como transferência, desfazer, orçar, corrigir e "reabrir o app".

---

## Problemas comuns

| Sintoma | O que fazer |
| --- | --- |
| "Não foi possível abrir o cofre" citando um arquivo corrompido | Nada foi alterado. Restaure aquele arquivo de um backup (ou corrija o JSON) e reabra. |
| "A pasta do cofre não foi encontrada" | O disco externo ou a pasta sincronizada não está disponível. Conecte-o, ou escolha outra pasta na mesma tela. |
| Aviso vermelho "As últimas alterações não foram salvas no disco" | Veja a causa no aviso (pasta somente leitura, disco cheio…), resolva e clique em "Tentar salvar de novo". |
| `cargo` não encontrado ao rodar `npm run tauri …` | Abra um terminal novo depois de instalar o Rust. |
| `Port 1420 is already in use` | Já há um `npm run dev`/`tauri dev` aberto; feche-o. |
| Acentos estranhos numa importação | Abra uma issue com o nome do banco — alguns bancos declaram a codificação errada e o app pode precisar reconhecer mais um caso. |

## Roadmap

O planejamento vive nas [issues do GitHub](https://github.com/RafaelPulzi/finance-compass-local/issues). Os próximos passos já especificados:

- **#7 / #20** — aceitar ou recusar pares de transferência sugeridos entre duas contas importadas.
- **#9** — análise semanal (segunda a domingo).
- **#10** — dividir uma transação entre várias categorias.

## Licença

Ainda não há licença definida, e o repositório no GitHub é privado. Para que outras pessoas possam usar e contribuir, é preciso escolher uma licença (ex.: MIT ou GPL-3.0) e tornar o repositório público — ou convidá-las. Até lá, o código é de uso do autor.
