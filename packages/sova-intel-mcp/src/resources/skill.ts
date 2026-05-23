// ---------------------------------------------------------------------------
// sova://skill — the live Sova Intel agent skill (SKILL.md)
// ---------------------------------------------------------------------------

const SKILL_URL = "https://raw.githubusercontent.com/nydiokar/sova-intel/main/docs/agent-skill/SKILL.md";

export async function skillResourceHandler(): Promise<string> {
  try {
    const res = await fetch(SKILL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  } catch {
    return [
      "# Sova Intel Skill",
      "",
      "Live skill file temporarily unavailable.",
      `Fetch directly: ${SKILL_URL}`,
      "",
      "Quick reference:",
      "- wallet_hud: cheapest wallet signal (1cr) — use first",
      "- wallet_profile: full wallet intelligence (5cr)",
      "- token_holder_profiles: agent-optimised holder map (5cr)",
      "- wallet_similarity: coordination detection (5cr)",
      "- deep_token_analysis: bundled analysis (10cr) — not the default",
    ].join("\n");
  }
}
