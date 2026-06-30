'use strict';

const { emitCliError, emitCliSuccess, emitText } = require('../io');

const BASH_SCRIPT = `_yamlink() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local commands="build briefing create health validate query report links serve watch export on completions"
  local options="--vault --json --port --format --output --query --field --type --help"
  if [[ $COMP_CWORD -eq 1 ]]; then
    COMPREPLY=($(compgen -W "$commands" -- "$cur"))
  else
    COMPREPLY=($(compgen -W "$options" -- "$cur"))
  fi
}
complete -F _yamlink yamlink
`;

const ZSH_SCRIPT = `#compdef yamlink
_yamlink() {
  local -a commands options
  commands=(build briefing create health validate query report links serve watch export on completions)
  options=(--vault --json --port --format --output --query --field --type --help)
  if (( CURRENT == 2 )); then
    _describe 'command' commands
  else
    _describe 'option' options
  fi
}
_yamlink
`;

function run({ shell, json }) {
    const normalizedShell = String(shell || '').trim().toLowerCase();
    if (normalizedShell === 'bash') {
        if (json) {
            emitCliSuccess({ shell: 'bash', script: BASH_SCRIPT });
            return;
        }
        emitText(BASH_SCRIPT);
        return;
    }
    if (normalizedShell === 'zsh') {
        if (json) {
            emitCliSuccess({ shell: 'zsh', script: ZSH_SCRIPT });
            return;
        }
        emitText(ZSH_SCRIPT);
        return;
    }
    emitCliError({ json, error: 'Usage: yamlink completions <bash|zsh>', code: 'USAGE', exitCode: 1 });
}

module.exports = { run };
