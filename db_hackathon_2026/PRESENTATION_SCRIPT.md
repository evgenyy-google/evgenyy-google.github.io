# Antigravity 2.0 Keynote Script & Event Timeline

```text
00:00 [SLIDE 1] Title Screen (Video Hidden)
00:02 SPEAK: Welcome to Antigravity: Coding Agents in Action.
00:06 SPEAK: I'm Evgeny Yakimov, Staff Software Engineer at the Google Cloud CTO Office.
00:10 [SLIDE 2] Presenter Intro & Goal (Video Hidden)
00:10 SPEAK: Vibe coder by design, using GenAI to produce rapid customer pilots at top speed.
00:15 SPEAK: With years of experience in reliability, balancing fast velocity with mission-critical systems.
00:22 SPEAK: Today's goal: Maximize hackathon velocity through agentic workflows while sustaining peak productivity.
00:30 [SLIDE 3] Product Surfaces & Demo Start (Center Modal Zoom)
00:30 SPEAK: Here I am asking Antigravity to build a complete 2-tier application, and we'll keep an eye on how it's doing throughout our presentation.
00:34 [VIDEO] Zoomed prompt fast-forward typing (2.0x speed)
00:40 SPEAK: Once submitted, the agent will process our prompt, formulate an implementation plan, and execute tasks autonomously in the background.
00:50 [VIDEO] Side Panel Block 1 (1.5x speed)
00:50 SPEAK: Antigravity provides four product surfaces to fit any workflow: the Antigravity 2.0 Desktop app, CLI, a feature-rich IDE, and a Python SDK.
01:02 SPEAK: Each surface is powered by the same underlying harness, giving developers complete flexibility across a single intelligence engine.
01:15 [SLIDE 4] Full-Stack Harness Architecture (Side Panel 1.5x)
01:15 SPEAK: Now moving to architecture: here is the general structure of coding agent harnesses.
01:20 SPEAK: While all Antigravity surfaces share this harness, modern tools like Claude or Codex follow similar core patterns.
01:28 SPEAK: At the core, an autonomous ReAct loop drives execution, reasoning, and iterative planning.
01:35 SPEAK: Context engineering enables user-defined rules, skill loading, sub-agent dispatching, and automatic context compaction.
01:43 SPEAK: The tooling layer provides file system access, shell execution, local MCP servers, and external API integrations.
01:51 SPEAK: Everything is ultimately powered by latest Gemini models, driving reasoning and tool execution at every step.
02:00 [SLIDE 5] 4-Tier Model & Steering (Side Panel 1.5x)
02:00 SPEAK: Now let's examine the 4-tier model. Framing our thinking from product spec to implementation, with coding agents we must decide our trade-offs between speed and control.
02:14 SPEAK: Because models naturally jump across levels while making decisions, stay aware of the active level to steer effectively.
02:27 SPEAK: Use two-way dialogue: TELL to lock constraints, and ASK to leverage model expertise for new ideas and blind spots.
02:40 [VIDEO] Center Modal Splash - Local UI Audit (2.0x speed)
02:40 SPEAK: Let me pause to check in on our agent: with implementation finished, we can see it launching a subagent to locally test the live app.
02:50 [SLIDE 6] Prompt Evolution: Good vs Better (Side Panel 4.3x)
02:50 SPEAK: Next, let me show how prompt steering evolves: Basic prompts allow fast prototyping, but explicit stack constraints lock architecture early.
03:00 SPEAK: Locking tech stack contracts and interface rules upfront prevents chaotic drift on fast-moving projects.
03:10 [SLIDE 7] Prompt Evolution: Multi-Step Steering (Side Panel 1.78x)
03:10 SPEAK: In practice, I spend most of my time operating in multi-step feedback loops, actively steering models whenever they drift off course.
03:25 SPEAK: Interactive steering loops provide engineers with tight quality feedback cycles, exercising precise control over topology, stack locks, and execution without sacrificing momentum.
03:56 [VIDEO] Center Modal Splash - Cloud Run Live Deploy (2.0x speed)
03:56 SPEAK: Let's check back in on our agent: with the app built and packaged, it's autonomously deploying to Cloud Run and validating live site health.
04:10 [SLIDE 8] Hackathon Guidance & Takeaways (Side Panel 2.0x)
04:10 SPEAK: To wrap up with hackathon guidance, keep these three core principles in mind.
04:16 SPEAK: First, velocity: Leverage agents for rapid bootstrapping, establishing autonomous feedback loops.
04:24 [VIDEO] Side Panel Pause (1.0x frame hold)
04:24 SPEAK: Second, cohesion: Lock contracts down to Tier 3 upfront, preventing incompatible drift in team projects.
04:32 SPEAK: Third, autonomy: Empower agents with context to make decisions, sharing progress via Markdown artifacts or real-time chats.
04:40 [VIDEO] Center Modal Splash - Walkthrough Artifact (1.5x speed)
04:40 SPEAK: Let's see the final outcome of what our agent accomplished: here is the live walkthrough artifact it generated, documenting every step from PRD to production with full evidence collected along the way!
04:50 [SLIDE 9] Outro & Hackathon Farewell (Video Hidden)
04:50 SPEAK: Thank you for listening! Go build something extraordinary and have an amazing hackathon!
```