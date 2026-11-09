-- 知识库文档的转换「体检」：收录了几页、哪几页没收录、补回了多少条款编号、表头怎么认的，
-- 以及维护者选的转换设置、正文是否在网页上改过。网页新建的文档没有这一项。
ALTER TABLE kb_docs ADD COLUMN convert_info JSON NULL;
