export const DEMO_MODE = true; // Toggle this for real vs demo

export const mockCallData = {
  isActive: true,
  duration: 247, // 4:07 minutes
  callerId: "+1 (555) 234-5678",
  callerName: "Sarah Martinez",
  startTime: Date.now() - 247000,
};

export const mockTranscripts = [
  {
    id: "1",
    speaker: "agent",
    text: "Good morning! Thank you for calling Simple.biz. My name is Alex, how can I help you today?",
    timestamp: "00:00:03",
    confidence: 0.97,
  },
  {
    id: "2",
    speaker: "caller",
    text: "Hi Alex, I'm calling about my recent order. I haven't received a tracking number yet.",
    timestamp: "00:00:12",
    confidence: 0.94,
  },
  {
    id: "3",
    speaker: "agent",
    text: "I completely understand your concern. Let me pull up your account right away. Can I get your order number please?",
    timestamp: "00:00:18",
    confidence: 0.96,
  },
  {
    id: "4",
    speaker: "caller",
    text: "Sure, it's order number 10234-A.",
    timestamp: "00:00:27",
    confidence: 0.99,
  },
];

export const mockCoachingTips = [
  {
    id: "tip-1",
    type: "positive",
    category: "Greeting",
    message: "Excellent opening! You used the customer's name and offered clear help.",
    timestamp: "00:00:03",
    priority: "low",
  },
  {
    id: "tip-2",
    type: "suggestion",
    category: "Empathy",
    message: "Great empathy statement! Consider asking 'When did you place the order?' for more context.",
    timestamp: "00:00:18",
    priority: "medium",
  },
  {
    id: "tip-3",
    type: "action",
    category: "Process",
    message: "Remember to set expectation: 'This will take about 30 seconds to look up.'",
    timestamp: "00:00:27",
    priority: "high",
  },
];
