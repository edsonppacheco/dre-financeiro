// Busca tolerante a erro de digitação, sem dependência externa.
// Pontua candidatos contra uma consulta combinando: match exato, prefixo,
// substring, prefixo de palavra, subsequência e distância de edição
// (Levenshtein). Assim "paxeco" encontra "Edson Pacheco".

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

// Distância de Levenshtein (iterativa, O(n·m))
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + custo)
    }
    prev = cur
  }
  return prev[b.length]
}

// A query aparece como subsequência do alvo? (ex: "edpac" em "edson pacheco")
function ehSubsequencia(q: string, alvo: string): boolean {
  let i = 0
  for (let j = 0; j < alvo.length && i < q.length; j++) if (alvo[j] === q[i]) i++
  return i === q.length
}

/**
 * Pontua o quão bem `texto` casa com `query` (0 = não casa; maior = melhor).
 * Considera tokens (palavras) para casar nome/sobrenome em qualquer ordem.
 */
export function pontuarFuzzy(query: string, texto: string): number {
  const q = norm(query)
  const t = norm(texto)
  if (!q) return 1 // sem query: tudo passa (ranqueia por ordem original)
  if (!t) return 0

  if (t === q) return 1000
  if (t.startsWith(q)) return 900 - t.length * 0.1
  if (t.includes(q)) return 800 - t.indexOf(q)

  const tokens = t.split(' ')
  // Alguma palavra começa com a query?
  if (tokens.some((tok) => tok.startsWith(q))) return 700
  // Alguma palavra contém a query?
  if (tokens.some((tok) => tok.includes(q))) return 600

  // Melhor distância de edição contra o texto todo e contra cada palavra
  const candidatos = [t, ...tokens]
  let melhorDist = Infinity
  for (const c of candidatos) {
    // só compara palavras de tamanho parecido (evita casar query curta em palavra longa)
    if (Math.abs(c.length - q.length) > Math.max(2, Math.ceil(q.length * 0.5))) continue
    melhorDist = Math.min(melhorDist, levenshtein(q, c))
  }
  const limite = q.length <= 4 ? 1 : q.length <= 7 ? 2 : 3
  if (melhorDist <= limite) return 500 - melhorDist * 50

  // Subsequência (com pequena tolerância) como último recurso
  if (ehSubsequencia(q, t)) return 200 - t.length * 0.1

  return 0
}

/**
 * Filtra e ordena `itens` pelo texto de `getTexto`, do melhor match ao pior.
 * Sem query, retorna todos na ordem original.
 */
export function buscarFuzzy<T>(query: string, itens: T[], getTexto: (item: T) => string): T[] {
  if (!query.trim()) return itens
  return itens
    .map((item, i) => ({ item, i, score: pontuarFuzzy(query, getTexto(item)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.item)
}
