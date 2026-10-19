import { useCallback, useState } from 'react';
import {
  assistContinue,
  assistMeta,
  assistPolish,
  generateArticle,
  type AiAssistAction,
  type AssistMetaResult,
  type AssistTextResult,
  type GenerateArticleInput,
  type GeneratedArticle,
} from '../../lib/services/aiAssistService';

/**
 * AI 辅助写作状态机。
 *
 * 只负责防重入与进行中状态；错误一律抛出（service 已翻译为中文），
 * 由调用方 try/catch + showToast 决定提示方式。
 */
export function useAiAssist() {
  const [generating, setGenerating] = useState(false);
  const [assisting, setAssisting] = useState<string | null>(null);

  /** 跑单个 assist 动作：同一时刻只允许一个进行中的动作 */
  const runAssist = useCallback(
    async <T,>(action: AiAssistAction, run: () => Promise<T>): Promise<T> => {
      setAssisting(action);
      try {
        return await run();
      } finally {
        setAssisting(null);
      }
    },
    [],
  );

  const runArticle = useCallback(async (input: GenerateArticleInput): Promise<GeneratedArticle> => {
    setGenerating(true);
    try {
      return await generateArticle(input);
    } finally {
      setGenerating(false);
    }
  }, []);

  const runMeta = useCallback(
    (title: string, content: string): Promise<AssistMetaResult> =>
      runAssist('meta', () => assistMeta(title, content)),
    [runAssist],
  );

  const runPolish = useCallback(
    (selection: string): Promise<AssistTextResult> =>
      runAssist('polish', () => assistPolish(selection)),
    [runAssist],
  );

  const runContinue = useCallback(
    (content: string, selection: string): Promise<AssistTextResult> =>
      runAssist('continue', () => assistContinue(content, selection)),
    [runAssist],
  );

  return { generating, assisting, runArticle, runMeta, runPolish, runContinue };
}
