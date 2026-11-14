"""Regression checks for SQL identities; no Docker or database access."""
import tempfile
import unittest
from pathlib import Path
from jdbc_inventory import collect

class JdbcInventoryTest(unittest.TestCase):
    def collect_source(self,source):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'Repository.java'
            path.write_text(source)
            return collect([root])

    def test_reordering_methods_does_not_change_call_identity_or_sql(self):
        one='    void alpha(UUID id) { jdbc.update("UPDATE a SET value = ?", id); }\n'
        two='    void beta() { jdbc.query("SELECT b FROM b", rs -> {}); }\n'
        first=self.collect_source('class Repository {\n'+one+two+'}')
        second=self.collect_source('class Repository {\n'+two+one+'}')
        self.assertEqual(set(first),set(second))
        for key in first:self.assertEqual(first[key]['strings'],second[key]['strings'])
        self.assertEqual({'Repository.alpha/1:1','Repository.beta/0:1'},set(first))

    def test_wrapped_jdbc_calls_keep_the_same_identity_and_sql(self):
        compact='class Repository {\n    Long read() { return jdbc.queryForObject("SELECT count(*) FROM tasks",Long.class); }\n}'
        wrapped='class Repository {\n    Long read() { return jdbc\n        /* layout only */ . queryForObject (\n            "SELECT count(*) FROM tasks",Long.class); }\n}'
        before=self.collect_source(compact)
        after=self.collect_source(wrapped)
        self.assertEqual(set(before),set(after))
        self.assertEqual(before['Repository.read/0:1']['strings'],after['Repository.read/0:1']['strings'])

    def test_comments_strings_text_blocks_and_nested_generic_parameters_are_not_methods(self):
        source=r'''
class Repository {
    // jdbc.update("not SQL");
    String ignored="jdbc.query(\"also not SQL\")";
    public <T> T run(Map<UUID,List<T>> values, Supplier<T> value) {
        var text = """
            SELECT id, '-- } jdbc.update(' AS text
            FROM tasks
            """;
        jdbc.query(text, rs -> {});
        return value.get();
    }
}
'''
        rows=self.collect_source(source)
        self.assertEqual(['Repository.run/2:1'],list(rows))
        self.assertEqual('text',next(iter(rows.values()))['expression'])

    def test_overloaded_history_methods_and_multiple_calls_have_distinct_ids(self):
        source='''class Repository {
    void history(UUID id, int page) { jdbc.query("SELECT h", rs -> {}); }
    void history(UUID id, UUID actor, String type, String summary, Object details) {
        jdbc.update("INSERT INTO h VALUES (?)",id);
        jdbc.query("SELECT count(*) FROM h",rs -> {});
    }
}'''
        self.assertEqual({'Repository.history/2:1','Repository.history/5:1','Repository.history/5:2'},set(self.collect_source(source)))

    def test_unsupported_calls_ambiguous_overloads_and_missing_method_fail(self):
        with self.assertRaisesRegex(ValueError,'Add SQL coverage'):
            self.collect_source('class Repository {\n    void run() { jdbc.execute("SQL"); }\n}')
        with self.assertRaisesRegex(ValueError,'Ambiguous method'):
            self.collect_source('class Repository {\n    void run(UUID id) { jdbc.query("SELECT 1",rs -> {}); }\n    void run(String id) {}\n}')
        with self.assertRaisesRegex(ValueError,'enclosing method'):
            self.collect_source('class Repository {\nstatic { jdbc.update("SQL"); }\n}')

if __name__=='__main__':unittest.main()
