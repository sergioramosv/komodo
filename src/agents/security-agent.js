// src/agents/security-agent.js
import { BaseAgent } from './base-agent.js'; // Assuming BaseAgent is in base-agent.js in the same directory
import { LLM_MODELS } from '../config.js'; // Assuming config.js defines LLM_MODELS

class SecurityAgent extends BaseAgent {
  constructor(config = {}) {
    super('SecurityAgent');
    this.model = config.model || LLM_MODELS.FAST_MODEL; // Default to a fast model like Haiku/Flash
    this.verdictMap = {
      CRITICAL: 'BLOCK',
      HIGH: 'BLOCK', // Will require manual review
      MEDIUM: 'WARN',
      LOW: 'PASS', // Categorized as tech debt, so overall verdict defaults to PASS if only LOW findings
    };
  }

  // Generate the system prompt for the security agent
  // This prompt includes OWASP Top 10 and other security best practices
  getSystemPrompt() {
    return `
      You are an AI Security Agent specialized in identifying vulnerabilities in code.
      Your task is to analyze provided code snippets and identify potential security flaws based on:
      
      OWASP Top 10 (2021):
      1.  Injection (e.g., SQL, NoSQL, OS Command, LDAP, CRLF, Server-Side Template)
      2.  Broken Authentication (e.g., weak credentials, session management issues, improper authentication flows)
      3.  Sensitive Data Exposure (e.g., storing PII/credentials unencrypted, logging sensitive data, weak encryption algorithms)
      4.  XML External Entities (XXE)
      5.  Broken Access Control (e.g., horizontal/vertical privilege escalation, insecure direct object references, directory traversal)
      6.  Security Misconfiguration (e.g., default configurations, unprotected files/directories, excessive permissions, improper error handling)
      7.  Cross-Site Scripting (XSS) (e.g., reflected, stored, DOM-based)
      8.  Insecure Deserialization
      9.  Vulnerable and Outdated Components (e.g., using libraries with known vulnerabilities)
      10. Insufficient Logging & Monitoring (e.g., lack of audit trails, alerts)

      Additional Security Checks:
      -   Hardcoded Secrets (e.g., API keys, passwords, sensitive tokens directly in code)
      -   Insecure Dependencies (e.g., outdated packages with known vulnerabilities)
      -   Exposed .env files or sensitive configuration
      -   Missing Rate Limiting on critical endpoints
      -   Insecure HTTP Headers (e.g., missing Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options)
      -   Lack of Input Validation/Sanitization

      Your output MUST be a JSON object with the following structure:
      {
        "verdict": "BLOCK" | "WARN" | "PASS",
        "findings": [
          {
            "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
            "category": "OWASP_INJECTION" | "HARDCODED_SECRET" | "INSECURE_DEP" | "OTHER", // Use relevant OWASP category or other specific category
            "description": "Detailed explanation of the vulnerability and its potential impact.",
            "file": "Optional: filename where the finding was identified",
            "line": "Optional: line number where the finding was identified"
          }
        ],
        "summary": "Overall summary of the security scan, including total findings by severity."
      }

      The 'verdict' should be determined as follows:
      -   If any 'CRITICAL' finding exists: "BLOCK"
      -   If any 'HIGH' finding exists: "BLOCK" (and will require manual review)
      -   If any 'MEDIUM' finding exists: "WARN"
      -   If only 'LOW' findings exist: "PASS" (but note the tech debt)
      -   If no findings: "PASS"

      Analyze the provided code and provide your assessment ONLY in the specified JSON format. Do not include any other text or explanation outside the JSON.
    `;
  }

  // Placeholder for calling the LLM to scan code
  // In a real implementation, this would involve sending the system prompt
  // and the code snippet to the LLM and parsing its JSON response.
  async scanCode(codeSnippet, filePath = null) {
    // This is a mock implementation. Replace with actual LLM call.
    console.log(`Scanning code for vulnerabilities in ${filePath || 'snippet'}:`);
    console.log(codeSnippet);

    let llmRawResponse;
    try {
      // In a real scenario, this would use the actual LLM client from BaseAgent
      llmRawResponse = await this.callLLM(this.getSystemPrompt(), codeSnippet);
    } catch (llmError) {
      console.error("Error calling LLM for security scan:", llmError);
      return {
        verdict: "BLOCK", // Or a more appropriate error state
        findings: [{
          severity: "CRITICAL",
          category: "LLM_INTEGRATION_ERROR",
          description: `Failed to get response from LLM: ${llmError.message}`,
          file: filePath,
          line: null
        }],
        summary: "Security agent failed due to LLM integration error."
      };
    }

    let parsedLLMResponse;
    try {
        parsedLLMResponse = JSON.parse(llmRawResponse);
    } catch (error) {
        console.error("Error parsing LLM response:", error);
        console.error("Raw LLM response:", llmRawResponse);
        // Fallback or error handling
        return {
            verdict: "WARN",
            findings: [{
                severity: "MEDIUM",
                category: "AGENT_ERROR",
                description: "Failed to parse LLM security scan response. Manual review needed.",
                file: filePath,
                line: null
            }],
            summary: "Security agent failed to process results."
        };
    }

    let overallVerdict = 'PASS';
    let hasCritical = false;
    let hasHigh = false;
    let hasMedium = false;

    parsedLLMResponse.findings.forEach(finding => {
      if (finding.severity === 'CRITICAL') hasCritical = true;
      if (finding.severity === 'HIGH') hasHigh = true;
      if (finding.severity === 'MEDIUM') hasMedium = true;
    });

    if (hasCritical) {
      overallVerdict = 'BLOCK';
    } else if (hasHigh) {
      overallVerdict = 'BLOCK'; // Requires review
    } else if (hasMedium) {
      overallVerdict = 'WARN';
    } else if (parsedLLMResponse.findings.some(f => f.severity === 'LOW')) {
        overallVerdict = 'PASS'; // Low findings are tech debt, still considered 'PASS' for overall verdict
    } else {
        overallVerdict = 'PASS';
    }
    
    // Ensure the verdict in the response matches the calculated one
    parsedLLMResponse.verdict = overallVerdict;

    return parsedLLMResponse;
  }

  // Placeholder for the actual LLM call. This method would be implemented in BaseAgent
  // or a common utility for LLM interaction.
  async callLLM(systemPrompt, userPrompt) {
    // Mock implementation for now
    // In a real scenario, this would use a library like @google/generative-ai
    // For this task, it's a mock to satisfy the scanCode method's expectation
    console.log("Mock LLM Call:");
    console.log("System Prompt Length:", systemPrompt.length);
    console.log("User Prompt (code snippet) Length:", userPrompt.length);

    // Return a dummy JSON string that the scanCode method expects to parse
    return JSON.stringify({
      verdict: "PASS",
      findings: [],
      summary: "Mock scan: No security findings identified."
    });
  }
}

export { SecurityAgent };
