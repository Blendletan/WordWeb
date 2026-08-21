"""
Rebuilds data/words.json from /usr/share/dict/american-english: filters to
5-letter lowercase words, applies better-profanity plus a manual review
pass (see RESTORE / EXTRA_REMOVE below), builds the one-letter-substitution
adjacency graph, and keeps only the giant connected component.

Run from the repo root: python3 tools/build_word_graph.py
Requires: pip install better-profanity --break-system-packages

Rebuild (don't patch words.json by hand) after any change to the word
list — removing a word can disconnect others from the giant component.
"""
import json, re
from collections import defaultdict
from better_profanity import profanity

profanity.load_censor_words()

path = "/usr/share/dict/american-english"
words = set()
with open(path, encoding="utf-8", errors="ignore") as f:
    for line in f:
        w = line.strip()
        if len(w) == 5 and w.isalpha() and w.islower():
            words.add(w)

# Automated pass
auto_flagged = sorted(w for w in words if profanity.contains_profanity(w))

# Manual review pass (matching the project's established practice of erring
# toward inclusion for words with a common non-vulgar meaning, while keeping
# actual vulgarity and slurs out). This is a first pass — worth a look.
RESTORE = {
    "dopey","drunk","dummy","homey","hooch","junky","kinky","leper","loins",
    "lusty","moron","naked","nappy","ninny","paddy","panty","pasty","potty",
    "prick","prude","screw","slave","slope","snuff","souse","spunk","strip",
    "toots","tramp","urine","wench","woody",
    # dictionary/zoological/everyday meanings clearly dominate over any
    # vulgar reading, or (queer) the word's contemporary common usage is
    # neutral/reclaimed rather than a slur
    "asses","erect","opium","organ","queer","revue","scrog","unwed","vixen",
    "vodka","vomit"
}
EXTRA_REMOVE = {"coons"}  # caught by manual slur-root scan, not the auto filter

removed = (set(auto_flagged) - RESTORE) | EXTRA_REMOVE
words = sorted(words - removed)

print("Auto-flagged:", len(auto_flagged))
print("Restored (false positives):", len(RESTORE))
print("Extra manual removals:", EXTRA_REMOVE)
print("Final removed set (%d):" % len(removed), sorted(removed))
print("Final word count:", len(words))

# Rebuild adjacency + giant component from scratch (required after any
# word-list change — removed words can be articulation points)
buckets = defaultdict(list)
for w in words:
    for i in range(5):
        buckets[w[:i] + "*" + w[i+1:]].append(w)

adj = defaultdict(set)
for pattern, group in buckets.items():
    if len(group) > 1:
        for a in group:
            for b in group:
                if a != b:
                    adj[a].add(b)

visited = set()
components = []
for w in words:
    if w in visited:
        continue
    comp = []
    stack = [w]
    visited.add(w)
    while stack:
        cur = stack.pop()
        comp.append(cur)
        for nb in adj.get(cur, ()):
            if nb not in visited:
                visited.add(nb)
                stack.append(nb)
    components.append(comp)

components.sort(key=len, reverse=True)
print("\nGiant component size:", len(components[0]), "(was 3534 before filtering)")
print("Top 5 component sizes:", [len(c) for c in components[:5]])

giant = set(components[0])
giant_list = sorted(giant)
index = {w: i for i, w in enumerate(giant_list)}
adjacency_idx = [[index[n] for n in sorted(adj[w] & giant)] for w in giant_list]

out = {"words": giant_list, "adjacency": adjacency_idx}
with open("data/words.json", "w") as f:
    json.dump(out, f, separators=(",", ":"))
import os
print("words.json size (KB):", os.path.getsize("data/words.json") / 1024)
