import { motion } from 'motion/react';
import type { Article } from '../types';

interface GlossaryProps {
  articles: Article[];
  onSelect: (id: string) => void;
}

export default function Glossary({ articles, onSelect }: GlossaryProps) {
  if (articles.length === 0) {
    return (
      <div className="glossary">
        <div className="glossary-header">
          <h1 className="glossary-title">02. Index</h1>
          <p className="glossary-subtitle">An alphabetized glossary of your themes</p>
        </div>
        <div className="glossary-empty">
          <span style={{ fontFamily: 'var(--mono)', fontSize: 32 }}>A—Z</span>
          <span style={{ marginTop: 12, display: 'block' }}>Save articles and add themes to build your index.</span>
        </div>
      </div>
    );
  }

  // Build glossary data
  const topicsMap: Record<string, Article[]> = {};
  const unthemed: Article[] = [];

  articles.forEach(article => {
    if (article.tags.length === 0) {
      unthemed.push(article);
    } else {
      article.tags.forEach(tag => {
        if (!topicsMap[tag]) topicsMap[tag] = [];
        topicsMap[tag].push(article);
      });
    }
  });

  const allTopics = Object.keys(topicsMap).sort();
  
  // Group by first letter
  const alphabetMap: Record<string, string[]> = {};
  allTopics.forEach(topic => {
    const letter = topic.charAt(0).toUpperCase();
    if (!alphabetMap[letter]) alphabetMap[letter] = [];
    alphabetMap[letter].push(topic);
  });

  const letters = Object.keys(alphabetMap).sort();

  return (
    <div className="glossary">
      <div className="glossary-header">
        <h1 className="glossary-title">02. Index</h1>
        <p className="glossary-subtitle">An alphabetized glossary of your themes</p>
      </div>

      <div className="glossary-content">
        {letters.map(letter => (
          <div key={letter} className="glossary-letter-group">
            <h2 className="glossary-letter">{letter}</h2>
            <div className="glossary-topics">
              {alphabetMap[letter].map(topic => (
                <div key={topic} className="glossary-topic">
                  <h3 className="glossary-topic-name">{topic}</h3>
                  <ul className="glossary-article-list">
                    {topicsMap[topic].map((article, i) => (
                      <motion.li 
                        key={article.id + i} 
                        className="glossary-article-item" 
                        onClick={() => onSelect(article.id)}
                        whileHover={{ x: 4 }}
                        transition={{ duration: 0.2 }}
                      >
                        <span className="glossary-article-title">{article.title}</span>
                        {article.author && <span className="glossary-article-author">, by {article.author}</span>}
                      </motion.li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ))}

        {unthemed.length > 0 && (
          <div className="glossary-letter-group">
            <h2 className="glossary-letter">#</h2>
            <div className="glossary-topics">
              <div className="glossary-topic">
                <h3 className="glossary-topic-name">Unthemed</h3>
                <ul className="glossary-article-list">
                  {unthemed.map((article, i) => (
                    <motion.li 
                      key={article.id + i} 
                      className="glossary-article-item" 
                      onClick={() => onSelect(article.id)}
                      whileHover={{ x: 4 }}
                      transition={{ duration: 0.2 }}
                    >
                      <span className="glossary-article-title">{article.title}</span>
                      {article.author && <span className="glossary-article-author">, by {article.author}</span>}
                    </motion.li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
