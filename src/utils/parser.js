/**
 * Extrae el primer bloque JSON válido de un texto.
 * Maneja JSON puro, JSON envuelto en ```json ... ```, y JSON mezclado con texto.
 *
 * @param {string} text - Texto que puede contener JSON
 * @returns {object|null} Objeto parseado o null si no se encuentra JSON válido
 */
export function extractJSON(text) {
  if (!text || typeof text !== 'string') return null;

  // 1. Intentar parsear el texto completo directamente
  try {
    return JSON.parse(text.trim());
  } catch {
    // No es JSON puro, seguimos intentando
  }

  // 2. Buscar JSON dentro de code fences: ```json ... ``` o ``` ... ```
  const codeFenceRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g;
  let match;
  while ((match = codeFenceRegex.exec(text)) !== null) {
    try {
      return JSON.parse(match[1].trim());
    } catch {
      // Este bloque no era JSON válido, seguir buscando
    }
  }

  // 3. Buscar el primer { ... } o [ ... ] balanceado en el texto
  const jsonStart = text.search(/[{[]/);
  if (jsonStart === -1) return null;

  const opener = text[jsonStart];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = jsonStart; i < text.length; i++) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === opener) depth++;
    if (char === closer) depth--;

    if (depth === 0) {
      const candidate = text.slice(jsonStart, i + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * Valida que un objeto JSON tenga los campos requeridos.
 *
 * @param {object} json - Objeto a validar
 * @param {string[]} requiredFields - Campos obligatorios
 * @returns {{ valid: boolean, missing: string[] }}
 */
export function validateAgentResponse(json, requiredFields) {
  if (!json || typeof json !== 'object') {
    return { valid: false, missing: requiredFields };
  }

  const missing = requiredFields.filter(field => !(field in json));

  return {
    valid: missing.length === 0,
    missing,
  };
}
