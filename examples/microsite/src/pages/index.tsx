import { FunctionalComponent } from 'preact';
import { definePage } from 'microsite/page';
import { Head, seo } from 'microsite/head';

interface IndexProps {}

const Index: FunctionalComponent<IndexProps> = () => {
  return (
    <>
      <Head>
        <seo.title>Microsite</seo.title>

        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="alternate icon" href="/favicon.ico" />
      </Head>

      <main>
        <h1>Welcome to Microsite!</h1>
        <p>
          Ready to build something amazing? <a href="https://microsite.page">Read the docs</a> to get started.
        </p>
      </main>
    </>
  );
};

export default definePage(Index);
