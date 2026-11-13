"""Source inventory for the SQL plan runner; unsupported Java shapes fail explicitly."""
from pathlib import Path
import hashlib
import json
import re
import textwrap

# Blank comments and string literals while preserving offsets and line numbers.
TOKENS=re.compile(r'"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|//[^\n]*|/\*[\s\S]*?\*/')
METHOD=re.compile(r"(?m)^ {4}(?:(?:public|private|protected|static|final|synchronized)\s+)*"
    r"(?:<[^>]+>\s+)?[\w.$<>,?\[\] ]+?\s+(\w+)\(([^;{}]*?)\)\s*(?:throws [\w., ]+)?\s*\{")

def masked(source):
    return TOKENS.sub(lambda m: ''.join('\n' if c=='\n' else ' ' for c in m.group()),source)

def argument_count(parameters):
    if not parameters.strip(): return 0
    depth=0; count=1
    for ch in parameters:
        if ch in '(<[': depth+=1
        elif ch in ')>]': depth-=1
        elif ch==',' and depth==0: count+=1
    return count

def methods(source):
    code=masked(source); result=[]
    for m in METHOD.finditer(code):
        start=m.end(); end=start; depth=1
        while depth and end<len(code):
            depth += (code[end]=='{')-(code[end]=='}')
            end+=1
        if depth: raise ValueError('Unclosed Java method: '+m.group(1))
        result.append((start,end,f'{m.group(1)}/{argument_count(m.group(2))}'))
    return code,result

def first_arg(source,start):
    pos=start; depth=0; strings=[]
    while pos<len(source):
        if source.startswith('"""',pos):
            end=source.index('"""',pos+3)
            strings.append(textwrap.dedent(source[pos+3:end]).strip());pos=end+3;continue
        if source[pos]=='"':
            end=pos+1
            while end<len(source):
                if source[end]=='\\':end+=2;continue
                if source[end]=='"':break
                end+=1
            strings.append(json.loads(source[pos:end+1]));pos=end+1;continue
        ch=source[pos]
        if ch==',' and depth==0:break
        if ch=='(':depth+=1
        if ch==')':
            if depth==0:break
            depth-=1
        pos+=1
    return source[start:pos],strings

def collect(roots):
    inventory={}
    for root in roots:
        for path in sorted(Path(root).rglob('*.java')):
            source=path.read_text();code,owners=methods(source);counts={}
            for match in re.finditer(r'\bjdbc\.(\w+)\(',code):
                if match.group(1) not in {'queryForObject','query','update','batchUpdate'}:
                    raise ValueError(f'Add SQL coverage for {path}: {match.group(1)}')
                enclosing=[m for m in owners if m[0]<=match.start()<m[1]]
                if len(enclosing)!=1:
                    raise ValueError(f'SQL must have one supported enclosing method: {path}:{source.count(chr(10),0,match.start())+1}')
                method=enclosing[0][2]
                if sum(owner[2]==method for owner in owners)!=1:
                    raise ValueError('Ambiguous method overload: '+str(path)+': '+method)
                counts[method]=counts.get(method,0)+1
                key=f'{path.stem}.{method}:{counts[method]}'
                if key in inventory:raise ValueError('Ambiguous SQL identity: '+key)
                expression,strings=first_arg(source,match.end())
                inventory[key]={'id':key,'method':method,'file':str(path),
                    'line':source.count('\n',0,match.start())+1,'expression':expression,'strings':strings,
                    'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                    'database':'si_emulator_test' if '/emulator/' in str(path) else 'si_test'}
    if not inventory:raise ValueError('No JDBC calls found')
    return inventory
