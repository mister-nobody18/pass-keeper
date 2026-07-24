// A small, hand-picked list of extremely common passwords (top entries from widely-published
// breach-derived "worst passwords" lists, e.g. Have I Been Pwned / SplashData round-ups).
// This is intentionally NOT a full breach corpus like zxcvbn ships (hundreds of thousands of
// entries) — it exists to catch the obvious, embarrassing cases cheaply, client-side, with no
// added dependency. See utils/passwordStrength.js for how it's used.
export const COMMON_PASSWORDS = new Set(
    [
        'password', 'password1', 'password123', '123456', '123456789', '12345678', '12345',
        '1234567890', '1234567', '111111', '000000', '123123', '1q2w3e4r', '1qaz2wsx', 'qazwsx',
        'qwerty', 'qwerty123', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'abc123', 'abcd1234',
        'letmein', 'letmein123', 'welcome', 'welcome1', 'monkey', 'dragon', 'football', 'baseball',
        'basketball', 'soccer', 'master', 'superman', 'batman', 'spiderman', 'starwars',
        'iloveyou', 'iloveu', 'trustno1', 'admin', 'admin123', 'administrator', 'root', 'toor',
        'login', 'passw0rd', 'p@ssword', 'p@ssw0rd', 'changeme', 'default', 'guest', 'test',
        'test123', 'temp123', 'sample', 'demo123', 'whatever', 'freedom', 'flower', 'sunshine',
        'princess', 'shadow', 'ashley', 'michael', 'jennifer', 'jordan', 'hunter', 'hunter2',
        'michelle', 'charlie', 'andrew', 'daniel', 'joshua', 'matthew', 'tigger', 'ranger',
        'buster', 'harley', 'ginger', 'cookie', 'summer', 'winter', 'autumn', 'nicole', 'chelsea',
        'biteme', 'jessica', 'pepper', 'zaq1zaq1', 'zaq12wsx', '1a2b3c4d', 'aaaaaa', 'aaaaaaaa',
        '11111111', '88888888', '99999999', 'qwe123', 'asd123', 'asdf1234', 'q1w2e3r4', 'a1b2c3d4',
        'passwordpassword', 'mypassword', 'mypass123', 'newpassword', 'newpass123', 'access',
        'access14', 'money', 'secret', 'ilovegod', 'jesus', 'blessed', 'family', 'friends',
        'internet', 'computer', 'cheese', 'purple', 'orange', 'yellow', 'silver', 'golden',
        'diamond', 'phoenix', 'dragon123', 'ferrari', 'porsche', 'mustang', 'corvette', 'thunder',
        'lightning', 'hockey', 'baseball1', 'football1', 'liverpool', 'chelsea1', 'arsenal',
        'letmein1', 'trustno1!', 'welcome123', 'changeme123', 'password!', 'password@',
        'password#', 'p@ssword1', 'Passw0rd', 'Passw0rd!', 'iloveyou1', 'iloveyou2', 'sunshine1',
        'princess1', 'dragon1', 'monkey1', 'shadow1', 'master1', 'hello123', 'hello12345',
        'freedom1', 'starwars1', 'trustme', 'nothing', 'whatever1', '123qwe', 'qwe123asd',
        'asdasd', 'zxczxc', 'qweqwe', '121212', '232323', '112233', '1qaz2wsx3edc',
    ].map((p) => p.toLowerCase())
);
