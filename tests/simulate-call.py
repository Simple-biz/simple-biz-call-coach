"""
Call Coach Simulation Test Harness
==================================
Simulates real calls by feeding transcripts incrementally to the WebSocket backend
and requesting AI tips at key decision points — just like pressing the button.

Each test case is a scripted conversation with "GENERATE TIP" trigger points.
At each trigger, we send the accumulated transcripts and validate the AI response.

Usage:
  python tests/simulate-call.py                    # Run all cases
  python tests/simulate-call.py --case 1           # Run specific case
  python tests/simulate-call.py --case 1 --verbose # Show full tip text
"""

import websocket
import json
import time
import sys
import os
import re
import argparse
from datetime import datetime, timedelta

# ============================================================================
# CONFIG
# ============================================================================

WS_URL = "wss://wu4pgdpdv9.execute-api.us-east-1.amazonaws.com/production"
API_KEY = "devassist-cce03814ca61352a852641fe9bb4542877975dd1d65d353ba0459add57c15efa"

# ============================================================================
# TEST CASES
# Each case is a list of (speaker, text) tuples with special "GENERATE_TIP" markers
# that include expected stage and keywords to validate
# ============================================================================

TEST_CASES = [
    # ========================================================================
    # CASE 1: Happy Path — Customer agrees, collect info, sign off
    # ========================================================================
    {
        "name": "Happy Path — Quick Agreement",
        "description": "Customer is interested from the start, agrees to callback, gives info",
        "transcript": [
            ("agent", "Hi. This is Kayser from simple.biz."),
            ("agent", "I'm reaching out about your business website. Do you have a minute?"),
            ("caller", "Yeah. Sure. What do you wanna talk about?"),
            ("agent", "So my partner Bob and I are local website designers."),
            ("agent", "What kind of business do you run, if you don't mind me asking?"),
            ("caller", "I run a bakery. We sell cakes, pastries, bread, stuff like that."),
            # TIP 1: Should suggest value prop / ask about website
            ("GENERATE_TIP", {
                "expected_stages": ["discovery", "engagement", "value_prop", "objection", "closing"],
                "should_contain_any": ["website", "online", "affordable", "bob"],
                "should_not_contain": ["your name", "what kind of business"],
                "description": "After learning business → pitch website services"
            }),
            ("agent", "That's awesome. A bakery! Do you currently have a website for your business?"),
            ("caller", "No, I don't have one yet. I've been thinking about it though."),
            # TIP 2: Should pitch affordable websites + ask for callback
            ("GENERATE_TIP", {
                "expected_stages": ["value_prop", "objection", "closing"],
                "should_contain_any": ["bob", "call", "affordable", "partner"],
                "should_not_contain": ["do you have a website"],
                "description": "Customer has no website → pitch services + callback"
            }),
            ("agent", "We're super affordable and can get you set up. Would you mind if my partner Bob gives you a quick call?"),
            ("caller", "Yeah sure, that sounds good."),
            # TIP 3: Should detect agreement → CONVERSION, collect name
            ("GENERATE_TIP", {
                "expected_stages": ["conversion"],
                "should_contain_any": ["name", "your name"],
                "should_not_contain": ["website", "do you have", "phone number"],
                "description": "Customer agreed → ask for name (CONVERSION)"
            }),
            ("agent", "Awesome! And your name is?"),
            ("caller", "My name is Sarah. You can call me Sarah."),
            # TIP 4: Should ask for email (not phone — we already have it)
            ("GENERATE_TIP", {
                "expected_stages": ["conversion"],
                "should_contain_any": ["email", "reach you"],
                "should_not_contain": ["phone", "number", "your name"],
                "description": "Got name → ask for email (NOT phone)"
            }),
            ("agent", "Perfect, Sarah. What's the best email to reach you at?"),
            ("caller", "You can email me at sarah@bakery.com."),
            # TIP 5: Should sign off — all info collected
            ("GENERATE_TIP", {
                "expected_stages": ["conversion", "signoff"],
                "should_contain_any": ["call you back", "beautiful day", "excited", "take care"],
                "should_not_contain": ["phone", "your name", "email"],
                "description": "All info collected → sign off"
            }),
        ]
    },

    # ========================================================================
    # CASE 2: Customer has website — test website awareness
    # ========================================================================
    {
        "name": "Has Website — SEO Pivot",
        "description": "Customer already has a website. Tips should pivot to SEO, not ask about website again.",
        "transcript": [
            ("agent", "Hi. This is Kayser from simple.biz."),
            ("agent", "I'm reaching out about your business website. Do you have a minute?"),
            ("caller", "Yeah sure."),
            ("agent", "My partner Bob and I are local website designers. What kind of business do you run?"),
            ("caller", "I run a plumbing business."),
            ("agent", "Nice! Do you currently have a website for your plumbing business?"),
            ("caller", "Yeah, I already have a website. My developer set it all up."),
            # TIP 1: Customer HAS website → pivot to SEO/optimization, NOT ask again
            ("GENERATE_TIP", {
                "expected_stages": ["objection", "objection_handling", "closing", "value_prop"],
                "should_contain_any": ["seo", "optimize", "SEO", "traffic", "ranking"],
                "should_not_contain": ["do you have a website", "set up a website"],
                "description": "Customer has website → pivot to SEO optimization"
            }),
            ("agent", "That's great you already have one! We also optimize websites with SEO at super affordable cost."),
            ("agent", "Would you mind if my partner Bob gives you a quick call to go over what we can do?"),
            ("caller", "My website works fine. I don't think I need anything right now."),
            # TIP 2: Objection — should handle gracefully, NOT repeat SEO pitch
            ("GENERATE_TIP", {
                "expected_stages": ["objection", "objection_handling", "closing"],
                "should_contain_any": ["bob", "call", "quick", "no pressure", "get it", "understand"],
                "should_not_contain": ["do you have a website", "seo at super affordable"],
                "description": "Customer objecting → soft callback ask, not repeat pitch"
            }),
        ]
    },

    # ========================================================================
    # CASE 3: Customer asks "Who's Bob?" — test latest exchange priority
    # ========================================================================
    {
        "name": "Who's Bob? — Latest Exchange Priority",
        "description": "Customer asks a question mid-conversion. Tip MUST answer that question, not continue flow.",
        "transcript": [
            ("agent", "Hi. This is Kayser from simple.biz."),
            ("agent", "I'm reaching out about your business website. Do you have a minute?"),
            ("caller", "Yeah go ahead."),
            ("agent", "My partner Bob and I are local website designers. What kind of business do you run?"),
            ("caller", "I sell pet food. Dog food, cat food, that kind of stuff."),
            ("agent", "That's awesome. Do you have a website for your pet food business?"),
            ("caller", "Yeah but it has SEO problems. I'm not really techy."),
            ("agent", "That's actually what we specialize in. Would you mind if my partner Bob gives you a quick call?"),
            ("caller", "Yeah definitely. But who's this Bob guy? Is he a developer?"),
            # TIP: MUST answer "who's Bob" — NOT skip ahead to ask for name
            ("GENERATE_TIP", {
                "expected_stages": ["conversion", "closing"],
                "should_contain_any": ["bob", "partner", "technical", "expert", "handle", "specialist"],
                "should_not_contain": [],
                "description": "Customer asked 'who is Bob' → MUST answer that question first"
            }),
            ("agent", "Yeah, Bob's my partner. He's the technical expert who handles website optimization and SEO."),
            ("caller", "Oh okay that sounds good. My name is Marcus by the way."),
            # TIP: Customer volunteered name → ask for email (not re-ask name)
            ("GENERATE_TIP", {
                "expected_stages": ["conversion"],
                "should_contain_any": ["email", "reach you", "Marcus"],
                "should_not_contain": ["your name", "what's your name", "phone number"],
                "description": "Customer gave name voluntarily → ask for email"
            }),
        ]
    },

    # ========================================================================
    # CASE 4: Repeated objections — test escalation + respect decline
    # ========================================================================
    {
        "name": "Repeated Objections — Escalation",
        "description": "Customer says no multiple times. Tips should escalate to softer ask, then decline.",
        "transcript": [
            ("agent", "Hi. This is Kayser from simple.biz."),
            ("agent", "I'm reaching out about your business website. Do you have a minute?"),
            ("caller", "Yeah what is it?"),
            ("agent", "My partner Bob and I are local website designers. What kind of business do you run?"),
            ("caller", "I have a landscaping company."),
            ("agent", "Do you currently have a website?"),
            ("caller", "Yeah I already have one. My nephew does it for me."),
            ("agent", "That's great! We also optimize websites with SEO at super affordable cost. Would you mind if Bob gives you a call?"),
            ("caller", "No I'm good. My nephew handles everything."),
            # TIP 1: First rejection — should try softer approach
            ("GENERATE_TIP", {
                "expected_stages": ["objection", "objection_handling", "closing"],
                "should_contain_any": ["understand", "no pressure", "bob", "quick", "get it", "awesome"],
                "should_not_contain": ["do you have a website"],
                "description": "First objection → try softer callback ask"
            }),
            ("agent", "No pressure at all. Would it be easier if Bob just gave you a quick call? Super quick."),
            ("caller", "Look, I already told you. I'm not interested. My website is fine."),
            # TIP 2: Repeated rejection — should respect decline
            ("GENERATE_TIP", {
                "expected_stages": ["objection", "objection_handling", "closing", "signoff"],
                "should_contain_any": ["appreciate", "thank", "great day", "take care", "no problem"],
                "should_not_contain": ["bob gives you a call", "would you mind"],
                "description": "Repeated objection → respect decline, end gracefully"
            }),
        ]
    },

    # ========================================================================
    # CASE 5: Sign-off — email NOT phone, "call back" NOT "call at email"
    # ========================================================================
    {
        "name": "Sign-off Wording — Call Back + Email",
        "description": "After collecting info, sign-off should say 'call back' not 'call at email'.",
        "transcript": [
            ("agent", "Hi. This is Kayser from simple.biz. Do you have a minute?"),
            ("caller", "Yeah sure."),
            ("agent", "My partner Bob and I are local website designers. What kind of business do you run?"),
            ("caller", "I sell candles online."),
            ("agent", "Do you have a website?"),
            ("caller", "Not yet but I want one."),
            ("agent", "We're super affordable. Would you mind if Bob gives you a quick call?"),
            ("caller", "Yeah that sounds good."),
            ("agent", "Awesome! And your name is?"),
            ("caller", "Lisa. Lisa Chen."),
            ("agent", "Perfect Lisa. What's the best email to reach you at?"),
            ("caller", "lisa@candleshop.com"),
            # TIP: Sign-off — should say "call you back", NOT "call at your email"
            ("GENERATE_TIP", {
                "expected_stages": ["conversion", "signoff"],
                "should_contain_any": ["call", "back", "beautiful day", "excited", "take care"],
                "should_not_contain": ["call at your email", "call you at lisa", "phone number"],
                "description": "Sign-off should say 'call back' not 'call at email'"
            }),
        ]
    },

    # ========================================================================
    # CASE 6: Customer gives specific time — acknowledge it
    # ========================================================================
    {
        "name": "Specific Callback Time",
        "description": "Customer says 'call me after 4pm'. Tip should acknowledge that time.",
        "transcript": [
            ("agent", "Hi. This is Kayser from simple.biz. Do you have a minute?"),
            ("caller", "Yeah go ahead."),
            ("agent", "My partner Bob and I are local website designers. What kind of business do you run?"),
            ("caller", "I'm a personal trainer."),
            ("agent", "Do you have a website for your training business?"),
            ("caller", "No not yet."),
            ("agent", "We can help with that. Would you mind if Bob gives you a quick call?"),
            ("caller", "Okay fine. But make it quick. Call me after 4pm, I'm busy right now."),
            # TIP: Should acknowledge "after 4pm" and ask for name
            ("GENERATE_TIP", {
                "expected_stages": ["conversion", "signoff"],
                "should_contain_any": ["4", "after", "name", "email"],
                "should_not_contain": ["phone number"],
                "description": "Customer said 'after 4pm' → acknowledge time + ask name"
            }),
        ]
    },

    # ========================================================================
    # CASE 7: Customer already said they have website 3 times — DON'T ask again
    # ========================================================================
    {
        "name": "Triple Website Mention — Awareness Test",
        "description": "Customer said 'I have a website' 3 times. Tips must NEVER ask about website again.",
        "transcript": [
            ("agent", "Hi. This is Kayser from simple.biz. Do you have a minute?"),
            ("caller", "Yeah sure."),
            ("agent", "My partner Bob and I are local website designers. What kind of business do you run?"),
            ("caller", "I sell electric fans. Different kinds of fans."),
            ("agent", "Nice! Do you currently have a website for your fan business?"),
            ("caller", "Yeah I currently have a website for my business right now. It's still up and running."),
            ("agent", "That's great! We also optimize websites with SEO."),
            ("agent", "Would you mind if my partner Bob gives you a quick call?"),
            ("caller", "Since my website is already up and running, I haven't thought about doing anything else with it."),
            ("agent", "SEO can be tricky especially in a competitive space like fans. That's what we specialize in."),
            ("agent", "Do you mind if Bob gives you a quick call to walk you through some options?"),
            ("caller", "Look. My website seems really fine right now. I don't have any problems with it."),
            # TIP: Should NOT mention "do you have a website" — customer said it 3 times!
            ("GENERATE_TIP", {
                "expected_stages": ["objection", "objection_handling", "closing", "signoff"],
                "should_contain_any": ["understand", "no pressure", "appreciate", "great day", "take care"],
                "should_not_contain": ["do you have a website", "set up a website", "do you currently have"],
                "description": "Customer said 'I have a website' 3 TIMES → never ask again"
            }),
        ]
    },

    # ========================================================================
    # CASE 8: Identity check — "local website designers" not "marketing agency"
    # ========================================================================
    {
        "name": "Identity — Website Designers Not Agency",
        "description": "Tips should say 'local website designers' not 'digital marketing company'.",
        "transcript": [
            ("agent", "Hello?"),
            ("caller", "Hello? Who's this?"),
            ("agent", "Hi. This is Kayser from simple.biz. I'm reaching out about your business website. Do you have a minute?"),
            ("caller", "Oh my business website? Yeah what about it?"),
            # TIP: First pitch — should identify as "website designers" not "marketing"
            ("GENERATE_TIP", {
                "expected_stages": ["discovery", "engagement", "objection", "value_prop"],
                "should_contain_any": ["website designer", "bob", "what kind of business"],
                "should_not_contain": ["marketing agency", "marketing company", "digital marketing"],
                "description": "Identity should be 'website designers' not 'marketing'"
            }),
        ]
    },
]


# ============================================================================
# WEBSOCKET HELPER
# ============================================================================

class CallSimulator:
    def __init__(self, verbose=False):
        self.ws = None
        self.verbose = verbose
        self.conversation_id = None
        self.responses = []

    def _recv_filtered(self, target_type, timeout=15):
        """Read messages, skip STATUS_UPDATE broadcasts, return first matching type."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                self.ws.settimeout(max(1, deadline - time.time()))
                raw = self.ws.recv()
                msg = json.loads(raw)
                msg_type = msg.get("type", "")
                
                # Skip broadcast noise from other active calls
                if msg_type == "STATUS_UPDATE":
                    continue
                
                if msg_type == target_type or target_type is None:
                    return msg
                
                # Return errors immediately
                if msg_type == "ERROR":
                    if self.verbose:
                        print(f"  [ERROR] {msg.get('payload', {}).get('message', raw[:100])}")
                    return msg
                    
                if self.verbose:
                    print(f"  [recv] {msg_type}: {raw[:120]}")
                    
            except websocket.WebSocketTimeoutException:
                break
        return None

    def connect(self):
        self.ws = websocket.create_connection(
            f"{WS_URL}?apiKey={API_KEY}",
            timeout=30
        )
        # Drain any initial STATUS_UPDATE broadcasts (wait briefly)
        deadline = time.time() + 2
        while time.time() < deadline:
            try:
                self.ws.settimeout(1)
                raw = self.ws.recv()
                msg = json.loads(raw)
                if msg.get("type") != "STATUS_UPDATE":
                    break
            except:
                break
        
        if self.verbose:
            print(f"  Connected to WebSocket")
        return True

    def start_conversation(self):
        self.ws.send(json.dumps({
            "action": "startConversation",
            "agentId": f"test-agent-{int(time.time())}",
            "timestamp": int(time.time() * 1000)
        }))
        
        # Wait for CONVERSATION_STARTED, skipping STATUS_UPDATE broadcasts
        resp = self._recv_filtered("CONVERSATION_STARTED", timeout=10)
        if resp:
            self.conversation_id = resp.get("payload", {}).get("conversationId")
        
        if not self.conversation_id:
            raise Exception("Failed to get conversationId from startConversation")
            
        if self.verbose:
            print(f"  Conversation: {self.conversation_id}")
        return self.conversation_id

    def send_transcript(self, speaker, text, ts_ms):
        """Send a single transcript line to the DB."""
        self.ws.send(json.dumps({
            "action": "transcript",
            "conversationId": self.conversation_id,
            "speaker": speaker,
            "text": text,
            "timestamp": ts_ms,
            "isFinal": True
        }))
        # Small delay to let DB write complete
        time.sleep(0.15)

    def request_tip(self, accumulated_transcripts):
        """
        Two-step tip request (mirrors the extension flow):
        1. Auto-analysis (skipTip=true) to populate intelligence cache
        2. Tip request (skipTip=false) with client transcripts
        """
        # Step 1: Populate intelligence cache
        self.ws.send(json.dumps({
            "action": "getIntelligence",
            "conversationId": self.conversation_id,
            "skipTip": True,
            "timestamp": int(time.time() * 1000)
        }))

        # Read auto-analysis response (skip STATUS_UPDATE broadcasts)
        intel_resp = self._recv_filtered("INTELLIGENCE_UPDATE", timeout=15)
        
        if self.verbose and intel_resp:
            payload = intel_resp.get("payload", {})
            print(f"  [Intel] business={payload.get('business')}, intents={payload.get('intents')}")

        time.sleep(0.5)

        # Step 2: Request tip with client transcripts
        self.ws.send(json.dumps({
            "action": "getIntelligence",
            "conversationId": self.conversation_id,
            "skipTip": False,
            "transcripts": accumulated_transcripts,
            "timestamp": int(time.time() * 1000)
        }))

        # Collect streaming TIP_CHUNK responses (skip STATUS_UPDATE)
        tip_text = ""
        tip_stage = ""
        tip_heading = ""
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                self.ws.settimeout(15)
                raw = self.ws.recv()
                msg = json.loads(raw)
                msg_type = msg.get("type", "")

                # Skip broadcast noise
                if msg_type == "STATUS_UPDATE":
                    continue

                if msg_type == "TIP_CHUNK":
                    payload = msg.get("payload", {})
                    delta = payload.get("delta", "")
                    tip_text += delta
                    # First chunk includes heading and stage
                    if payload.get("heading"):
                        tip_heading = payload["heading"]
                    if payload.get("stage"):
                        tip_stage = payload["stage"]

                elif msg_type == "INTELLIGENCE_UPDATE":
                    # Final response — may contain aiTip with full text
                    payload = msg.get("payload", {})
                    ai_tip = payload.get("aiTip", {})
                    if ai_tip:
                        tip_stage = ai_tip.get("stage", tip_stage)
                        tip_heading = ai_tip.get("heading", tip_heading)
                        # If we didn't get streaming chunks, use the full suggestion
                        if not tip_text:
                            tip_text = ai_tip.get("suggestion", "")
                        break
                    # If no aiTip, this is just a cache update — skip
                    continue
                    
                elif msg_type == "ERROR":
                    err = msg.get("payload", {})
                    if self.verbose:
                        print(f"  ❌ ERROR: {err.get('message', err.get('code', 'unknown'))}")
                    break

            except websocket.WebSocketTimeoutException:
                break

        return tip_text, tip_stage

    def close(self):
        if self.ws:
            try:
                self.ws.close()
            except:
                pass


# ============================================================================
# VALIDATION
# ============================================================================

def validate_tip(tip_text, tip_stage, expectations):
    """Validate a tip against expected criteria. Returns (passed, issues)."""
    issues = []
    tip_lower = tip_text.lower()
    
    # Extract script portion for should_not_contain checks (don't flag context mentions)
    script_match = re.search(r'\[SCRIPT\]:\s*(.+?)(?:\[|$)', tip_text, re.DOTALL)
    script_lower = script_match.group(1).strip().lower() if script_match else tip_lower

    # Check stage
    if expectations.get("expected_stages"):
        if tip_stage.lower() not in [s.lower() for s in expectations["expected_stages"]]:
            issues.append(f"Stage '{tip_stage}' not in expected {expectations['expected_stages']}")

    # Check should_contain_any (against full tip text)
    if expectations.get("should_contain_any"):
        found_any = any(kw.lower() in tip_lower for kw in expectations["should_contain_any"])
        if not found_any:
            issues.append(f"Missing keywords (need any of): {expectations['should_contain_any']}")

    # Check should_not_contain (against SCRIPT portion only)
    if expectations.get("should_not_contain"):
        for kw in expectations["should_not_contain"]:
            if kw.lower() in script_lower:
                issues.append(f"Script contains forbidden: '{kw}'")

    passed = len(issues) == 0
    return passed, issues


# ============================================================================
# MAIN TEST RUNNER
# ============================================================================

def run_test_case(case_num, case, verbose=False):
    """Run a single test case and return results."""
    print(f"\n{'='*70}")
    print(f"  CASE {case_num}: {case['name']}")
    print(f"  {case['description']}")
    print(f"{'='*70}")

    sim = CallSimulator(verbose=verbose)
    results = []
    
    try:
        sim.connect()
        sim.start_conversation()
        
        accumulated = []
        base_ts = int(time.time() * 1000) - 300000  # 5 min ago
        ts_offset = 0
        tip_num = 0

        for item in case["transcript"]:
            if item[0] == "GENERATE_TIP":
                tip_num += 1
                expectations = item[1]
                
                print(f"\n  --- TIP {tip_num}: {expectations['description']} ---")
                
                # Wait for DB writes to settle before requesting tip
                time.sleep(8)
                
                # Drain any pending STATUS_UPDATE messages
                try:
                    while True:
                        sim.ws.settimeout(0.5)
                        raw = sim.ws.recv()
                        msg = json.loads(raw)
                        if msg.get("type") != "STATUS_UPDATE":
                            break
                except:
                    pass
                
                # Request tip with accumulated client transcripts
                tip_text, tip_stage = sim.request_tip(accumulated)
                
                # Parse out the script portion for cleaner display
                script_match = re.search(r'\[SCRIPT\]:\s*(.+?)(?:\[|$)', tip_text, re.DOTALL)
                script_text = script_match.group(1).strip() if script_match else tip_text[:200]
                
                stage_match = re.search(r'\[STAGE\]:\s*(\w+)', tip_text)
                parsed_stage = stage_match.group(1).lower() if stage_match else tip_stage.lower()
                
                if verbose:
                    print(f"  Full tip: {tip_text[:300]}")
                print(f"  Stage: {parsed_stage}")
                print(f"  Script: {script_text[:150]}")
                
                passed, issues = validate_tip(tip_text, parsed_stage, expectations)
                
                if passed:
                    print(f"  ✅ PASS")
                else:
                    for issue in issues:
                        print(f"  ❌ FAIL: {issue}")

                results.append({
                    "tip_num": tip_num,
                    "description": expectations["description"],
                    "passed": passed,
                    "issues": issues,
                    "stage": parsed_stage,
                    "script": script_text[:150]
                })
            else:
                speaker, text = item
                ts_offset += 3000
                ts = base_ts + ts_offset
                
                # Send to DB
                sim.send_transcript(speaker, text, ts)
                
                # Accumulate for client-side sending
                accumulated.append({
                    "speaker": speaker,
                    "text": text
                })

    except Exception as e:
        print(f"  ❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
    finally:
        sim.close()

    return results


def main():
    parser = argparse.ArgumentParser(description="Call Coach Simulation Tests")
    parser.add_argument("--case", type=int, help="Run specific case number (1-based)")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show full tip text")
    args = parser.parse_args()

    print("=" * 70)
    print("  CALL COACH SIMULATION TEST HARNESS")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  WebSocket: {WS_URL}")
    print(f"  Test Cases: {len(TEST_CASES)}")
    print("=" * 70)

    all_results = []
    cases_to_run = []
    
    if args.case:
        if 1 <= args.case <= len(TEST_CASES):
            cases_to_run = [(args.case, TEST_CASES[args.case - 1])]
        else:
            print(f"Invalid case number. Valid range: 1-{len(TEST_CASES)}")
            sys.exit(1)
    else:
        cases_to_run = [(i + 1, c) for i, c in enumerate(TEST_CASES)]

    for case_num, case in cases_to_run:
        results = run_test_case(case_num, case, verbose=args.verbose)
        all_results.extend(results)
        # Small gap between cases so Lambda cache resets
        if case_num < len(cases_to_run):
            time.sleep(2)

    # Summary
    total = len(all_results)
    passed = sum(1 for r in all_results if r["passed"])
    failed = total - passed

    print(f"\n{'='*70}")
    print(f"  RESULTS: {passed}/{total} passed, {failed} failed")
    print(f"{'='*70}")

    if failed > 0:
        print("\n  FAILURES:")
        for r in all_results:
            if not r["passed"]:
                print(f"    ❌ Tip {r['tip_num']}: {r['description']}")
                for issue in r["issues"]:
                    print(f"       → {issue}")
                print(f"       Script: {r['script'][:100]}")

    print()
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
