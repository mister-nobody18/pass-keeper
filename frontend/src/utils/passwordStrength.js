import { COMMON_PASSWORDS } from './commonPasswords.js';

// Honest, dependency-free password strength estimate.
//
// This is NOT zxcvbn (no such library was already present in the project, and the brief asked
// us not to add one). What it deliberately avoids being is a naive character-class checker
// ("has upper + lower + digit + symbol = strong") — that scheme rewards things like "Passw0rd!"
// with a top score despite it being one of the first guesses any real attacker tries.
//
// Instead this estimates Shannon entropy from the character pool actually used and the
// password's length, then subtracts a penalty for low-entropy structure (runs, repeats,
// keyboard walks) and for exact matches against a small common-password list. The result is
// mapped to a 0-4 score plus a rough crack-time estimate under a stated attack model. It is a
// real, if simplified, information-theoretic estimate - not a rigorous one. It will not catch
// clever leetspeak-of-a-dictionary-word the way zxcvbn's pattern matching does.

const POOL = {
    lower: 26,
    upper: 26,
    digit: 10,
    // Printable ASCII symbols on a standard keyboard.
    symbol: 33,
};

// Guesses/second for the crack-time estimate. This intentionally models a *fast offline* attack
// against a weak/leaked hash (a conservative, pessimistic baseline used by most strength
// meters) - not this app's actual argon2id hashing, which is far slower. It's a worst-case
// yardstick, not a claim about this app's real resistance.
const GUESSES_PER_SECOND = 1e10;

function charPoolSize(password) {
    let pool = 0;
    if (/[a-z]/.test(password)) pool += POOL.lower;
    if (/[A-Z]/.test(password)) pool += POOL.upper;
    if (/[0-9]/.test(password)) pool += POOL.digit;
    if (/[^a-zA-Z0-9]/.test(password)) pool += POOL.symbol;
    return pool || 1;
}

const KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890'];

function longestKeyboardWalk(lower) {
    let longest = 0;
    for (const row of KEYBOARD_ROWS) {
        const reversed = row.split('').reverse().join('');
        for (const seq of [row, reversed]) {
            for (let start = 0; start < seq.length; start++) {
                let run = 1;
                while (
                    start + run < seq.length &&
                    lower.includes(seq.slice(start, start + run + 1))
                ) {
                    run++;
                }
                if (run > longest) longest = run;
            }
        }
    }
    return longest;
}

function longestCharRun(password) {
    // Longest run of either identical characters ("aaaa") or a simple ascending/descending
    // numeric or alphabetic sequence ("1234", "dcba").
    let longestRepeat = 1;
    let longestSequence = 1;
    let repeat = 1;
    let ascending = 1;
    let descending = 1;

    for (let i = 1; i < password.length; i++) {
        const prev = password.charCodeAt(i - 1);
        const curr = password.charCodeAt(i);

        repeat = curr === prev ? repeat + 1 : 1;
        ascending = curr === prev + 1 ? ascending + 1 : 1;
        descending = curr === prev - 1 ? descending + 1 : 1;

        longestRepeat = Math.max(longestRepeat, repeat);
        longestSequence = Math.max(longestSequence, ascending, descending);
    }
    return Math.max(longestRepeat, longestSequence);
}

const SCORE_LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];

function formatCrackTime(seconds) {
    if (seconds < 1) return 'instantly';
    const units = [
        ['century', 60 * 60 * 24 * 365 * 100],
        ['year', 60 * 60 * 24 * 365],
        ['day', 60 * 60 * 24],
        ['hour', 60 * 60],
        ['minute', 60],
        ['second', 1],
    ];
    for (const [name, unitSeconds] of units) {
        const value = seconds / unitSeconds;
        if (value >= 1) {
            const rounded = Math.round(value);
            if (name === 'century' && rounded >= 100) return 'centuries';
            return `${rounded} ${name}${rounded === 1 ? '' : 's'}`;
        }
    }
    return 'instantly';
}

/**
 * @param {string} password
 * @param {string[]} [context] extra strings to treat as "known" and penalize if reused verbatim
 *   (e.g. the account email), so a password that's just the user's email isn't scored as strong.
 */
export function estimatePasswordStrength(password, context = []) {
    if (!password) {
        return { score: 0, label: '', crackTimeLabel: '', feedback: [], entropyBits: 0 };
    }

    const lower = password.toLowerCase();
    const feedback = [];

    if (COMMON_PASSWORDS.has(lower)) {
        return {
            score: 0,
            label: SCORE_LABELS[0],
            crackTimeLabel: 'instantly',
            feedback: ['This is one of the most commonly used passwords.'],
            entropyBits: 0,
        };
    }

    for (const value of context) {
        const needle = (value || '').toLowerCase().trim();
        if (needle.length >= 4 && lower.includes(needle)) {
            return {
                score: 0,
                label: SCORE_LABELS[0],
                crackTimeLabel: 'instantly',
                feedback: ['Avoid using your email address in your password.'],
                entropyBits: 0,
            };
        }
    }

    const pool = charPoolSize(password);
    let entropyBits = password.length * Math.log2(pool);

    const repeatRun = longestCharRun(password);
    const keyboardWalk = longestKeyboardWalk(lower);
    const worstRun = Math.max(repeatRun, keyboardWalk);

    if (worstRun >= 3) {
        // Each character beyond a run of 2 contributes ~0 real entropy - it's predictable from
        // the one before it. Dock 8 bits per predictable character as a simple, explainable penalty.
        entropyBits -= (worstRun - 2) * 8;
        if (repeatRun >= 3) feedback.push('Avoid repeating or sequential characters.');
        if (keyboardWalk >= 4) feedback.push('Avoid keyboard patterns like "qwerty" or "asdf".');
    }

    entropyBits = Math.max(entropyBits, 0);

    if (password.length < 12) feedback.push('Use at least 12 characters.');
    if (charPoolSize(password) < POOL.lower + POOL.digit) {
        feedback.push('Mix in uppercase letters, numbers, or symbols.');
    }

    let score;
    if (entropyBits < 28) score = 0;
    else if (entropyBits < 36) score = 1;
    else if (entropyBits < 60) score = 2;
    else if (entropyBits < 80) score = 3;
    else score = 4;

    const crackTimeSeconds = Math.pow(2, entropyBits) / GUESSES_PER_SECOND;

    return {
        score,
        label: SCORE_LABELS[score],
        crackTimeLabel: formatCrackTime(crackTimeSeconds),
        feedback: score >= 3 ? [] : feedback,
        entropyBits: Math.round(entropyBits),
    };
}
