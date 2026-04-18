import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Simple Levenshtein distance implementation for fuzzy matching
 */
export function getLevenshteinDistance(a: string, b: string): number {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

/**
 * Find the closest match in a list of strings
 */
export function findBestMatch(target: string, choices: string[], threshold = 0.3): string | null {
  if (!target || choices.length === 0) return null;
  
  let bestMatch: string | null = null;
  let minDistance = Infinity;
  
  const normalizedTarget = target.toLowerCase().trim();

  for (const choice of choices) {
    const normalizedChoice = choice.toLowerCase().trim();
    
    // Exact match (case insensitive)
    if (normalizedTarget === normalizedChoice) return choice;
    
    const distance = getLevenshteinDistance(normalizedTarget, normalizedChoice);
    const score = distance / Math.max(normalizedTarget.length, normalizedChoice.length);
    
    if (score < minDistance && score <= threshold) {
      minDistance = score;
      bestMatch = choice;
    }
  }
  
  return bestMatch;
}
