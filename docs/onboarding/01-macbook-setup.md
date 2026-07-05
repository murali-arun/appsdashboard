# 01 — MacBook Setup

Get your machine ready to work on every project in the portfolio. Do this before Day 1.

Time: 1–2 hours (mostly waiting for installs).

---

## 1. Core tooling via Homebrew

Install Homebrew first if you don't have it:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Then install everything in one go:

```bash
brew install git gh python@3.12 node@20 hugo go ffmpeg pandoc jq wget
brew install --cask docker visual-studio-code iterm2
```

What each is for:

| Tool | Used by |
|------|---------|
| `git`, `gh` | All projects. `gh` is the GitHub CLI — you'll live in it. |
| `python@3.12` | `financialEngine`, `personal-assistant`, `personal-agent`, `keystone` backend |
| `node@20` | `gymSite`, `appsdashboard`, `webgpu-chess-replay`, `chess-mobile`, `keystone` mobile |
| `hugo` | `bloggingTemplate` (needs the **extended** version — Homebrew installs extended by default) |
| `pandoc` | `bloggingTemplate` DOCX-to-post conversion |
| `docker` (cask) | Every project that deploys — you'll run `docker compose` locally to test container builds |
| `jq` | Reading JSON from CLI output. Used a lot. |

## 2. Python — use pyenv or venv per project

Don't `pip install` into the system Python. Two options; pick one and stick with it:

**Option A — pyenv** (recommended if you juggle Python versions):

```bash
brew install pyenv
echo 'eval "$(pyenv init -)"' >> ~/.zshrc
pyenv install 3.12.4
pyenv global 3.12.4
```

**Option B — venv per project** (simpler, what most projects assume):

Every Python project has this pattern; you'll do it once per repo when you clone:

```bash
cd financialEngine
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 3. Node — use nvm

`brew install node@20` gets you Node 20, but some projects may drift. Install `nvm` so you can switch:

```bash
brew install nvm
mkdir ~/.nvm
# add to ~/.zshrc:
export NVM_DIR="$HOME/.nvm"
[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && \. "/opt/homebrew/opt/nvm/nvm.sh"

nvm install 20
nvm use 20
nvm alias default 20
```

## 4. Docker Desktop

- Install the cask (`brew install --cask docker`)
- Open Docker Desktop once from Applications, accept the license
- In Settings → Resources, give it at least **4 CPUs and 8GB RAM** (Docker builds for `webgpu-chess-replay` and `financialEngine` are big)
- In Settings → General, enable "Use Rosetta for x86/amd64 emulation on Apple Silicon" if you're on an M-series Mac (some base images are amd64-only)

Verify:

```bash
docker --version
docker compose version
docker run --rm hello-world
```

## 5. Mobile tooling (Expo / EAS)

Needed only for `chess-mobile` and `keystone` mobile. Install globally:

```bash
npm install -g expo-cli eas-cli
```

You'll also eventually need:

- **Xcode** (from the Mac App Store) — required to build/simulate iOS locally. It's a 10 GB download; kick it off overnight. After install, run `sudo xcode-select --install` for command-line tools.
- **Android Studio** (optional) — only if you want to run Android emulators locally. EAS builds Android in the cloud, so you can skip this for a while.

## 6. Shopify CLI

Needed only for `shopify-theme-v3`:

```bash
npm install -g @shopify/cli @shopify/theme
shopify version
```

## 7. Hugo — verify it's the extended build

```bash
hugo version
# output must contain "extended" — e.g. "hugo v0.130.0+extended darwin/arm64"
```

If it doesn't say `extended`, reinstall: `brew reinstall hugo`.

## 8. SSH key for VPS + GitHub

Generate a fresh SSH key (don't reuse a personal one):

```bash
ssh-keygen -t ed25519 -C "you@arun-projects" -f ~/.ssh/arun_projects
```

Add it to your agent:

```bash
eval "$(ssh-agent -s)"
ssh-add --apple-use-keychain ~/.ssh/arun_projects
```

Add to `~/.ssh/config`:

```
Host vps
  HostName <VPS_IP_FROM_ARUN>
  User <VPS_USER_FROM_ARUN>
  Port 22
  IdentityFile ~/.ssh/arun_projects

Host github.com
  User git
  IdentityFile ~/.ssh/arun_projects
```

Send the **public** key (`~/.ssh/arun_projects.pub`) to Arun. He'll:
- Add it to the VPS `~/.ssh/authorized_keys`
- Add it to your GitHub account so you can push over SSH

Test both:

```bash
ssh vps 'echo connected'
ssh -T git@github.com   # expect "Hi <username>!"
```

## 9. GitHub CLI login

```bash
gh auth login
# choose: GitHub.com → SSH → your ~/.ssh/arun_projects key → browser login
```

Then verify:

```bash
gh auth status
gh repo list <arun-github-handle>   # you should see all his repos
```

## 10. VS Code extensions (recommended)

Optional but massively helpful:

```
ms-python.python
ms-python.black-formatter
ms-python.isort
dbaeumer.vscode-eslint
esbenp.prettier-vscode
bradlc.vscode-tailwindcss
ms-azuretools.vscode-docker
GitHub.vscode-pull-request-github
```

Install from Extensions panel or with:

```bash
code --install-extension ms-python.python
# ... etc
```

## 11. `~/.zshrc` — the useful bits

Add these aliases and env vars:

```bash
# Homebrew (Apple Silicon)
eval "$(/opt/homebrew/bin/brew shellenv)"

# Python
alias py=python3.12
alias venv='python3.12 -m venv .venv && source .venv/bin/activate'
alias act='source .venv/bin/activate'

# Node / nvm
export NVM_DIR="$HOME/.nvm"
[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && \. "/opt/homebrew/opt/nvm/nvm.sh"

# Docker
alias dcu='docker compose up -d'
alias dcd='docker compose down'
alias dcl='docker compose logs -f'
alias dps='docker ps'

# VPS quick access
alias vps='ssh vps'
alias vpslogs='ssh vps "cd /opt && docker ps"'

# Git
alias gs='git status'
alias gp='git pull --rebase'
alias gco='git checkout'
alias glo='git log --oneline -20'
```

Reload: `source ~/.zshrc`.

## 12. Directory layout on your Mac

Recommended:

```
~/code/arun/
├── financialEngine/
├── personal-assistant/
├── personal-agent/
├── gymSite/
├── appsdashboard/
├── webgpu-chess-replay/
├── bloggingTemplate/
├── keystone/
├── chess-mobile/
├── shopify-theme-v3/
└── obsidianRemote/
```

Once Arun grants you GitHub access (see `02-access-checklist.md`), clone them all:

```bash
mkdir -p ~/code/arun && cd ~/code/arun
for repo in financialEngine personal-assistant personal-agent gymSite appsdashboard webgpu-chess-replay bloggingTemplate keystone chess-mobile shopify-theme-v3 obsidianRemote; do
  gh repo clone <arun-github-handle>/$repo
done
```

## Done. What next?

Move to [`02-access-checklist.md`](02-access-checklist.md) and work through it with Arun in a single sitting — it's much faster than pinging him one credential at a time.
